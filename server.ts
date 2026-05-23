import express from "express";
import dotenv from "dotenv";
dotenv.config();
import { createServer as createViteServer } from "vite";
import axios from "axios";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import url from "url";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import jwt from "jsonwebtoken";
import TelegramBot from 'node-telegram-bot-api';
import nodemailer from 'nodemailer';
import { GoogleGenAI } from "@google/genai";
import { query, initializeDatabase } from "./src/lib/db.ts";
import { MarketType, ExchangeConfig, SYMBOLS, getConfigsForMarket } from "./models/index.ts";
import { ServerSmarteyeEngine } from "./src/lib/server-engine.ts";

const __filename = import.meta.url ? fileURLToPath(import.meta.url) : '';
const __dirname = __filename ? path.dirname(__filename) : process.cwd();

// Telegram Bot Setup
const DEFAULT_BOT_TOKEN = '8277095257:AAG_5Xw_pLGQNqOH27guqfuNQ3fJV9OCbn0';
const botToken = process.env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;

if (botToken === DEFAULT_BOT_TOKEN) {
  console.warn('WARNING: Using default/public Telegram Bot Token. For production, set TELEGRAM_BOT_TOKEN in your environment secrets.');
}

const bot = new TelegramBot(botToken, { polling: true });

// Handle polling errors, specifically the 409 Conflict error which is common during dev server restarts
bot.on('polling_error', (error: any) => {
  if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
    console.warn('[Bot] Polling conflict (409). This usually happens when the dev server restarts and the previous instance is still active. Polling will automatically resume shortly.');
  } else {
    console.error('[Bot] Polling Error:', error.message || error);
  }
});

// Graceful shutdown to stop polling and prevent 409 conflicts on restart
const cleanup = async () => {
  console.log('Shutting down Telegram bot...');
  try {
    await bot.stopPolling();
    console.log('Telegram bot polling stopped.');
  } catch (err) {
    console.error('Error stopping Telegram bot polling:', err);
  }
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

bot.getMe().then(me => {
  console.log(`Telegram Bot started successfully: @${me.username}`);
}).catch(err => {
  console.error('FAILED to start Telegram Bot. Check your TELEGRAM_BOT_TOKEN:', err.message);
});

// UUID validation helper
const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

const PLAN_PRICES: Record<string, number> = {
  '1month': 1520,  // 19 * 80
  '6months': 7120, // 89 * 80
  '1year': 13920   // 174 * 80
};

const PLAN_LABELS: Record<string, string> = {
  '1month': 'Smarteye Pro (1 месяц)',
  '6months': 'Smarteye Pro (6 месяцев)',
  '1year': 'Smarteye Whale (1 год)'
};

// Helper to send menu/welcome message
const sendWelcomeMessage = (chatId: number) => {
  bot.sendMessage(chatId, 'Добро пожаловать в Smarteye Скринер! 🚀\n\nЗдесь вы можете приобрести подписку для доступа к профессиональным инструментам анализа криптовалютного рынка.', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '💎 Купить подписку (Stars)',
            callback_data: 'buy_subscription'
          }
        ]
      ]
    }
  }).catch(e => console.error('Error sending welcome message:', e));
};

// Main message handler to catch both commands and plain text
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.toLowerCase() || '';
  const telegramId = msg.from?.id;
  const telegramUsername = msg.from?.username;
  const telegramFirstName = msg.from?.first_name;

  console.log(`[Bot] Received message from ${telegramId} (@${telegramUsername}): "${text}"`);

  // Handle /start with potential deep link payload
  if (text.startsWith('/start')) {
    const payload = text.split(' ')[1];
    
    if (payload && payload.startsWith('pay_')) {
      const parts = payload.split('_');
      const userId = parts[1];
      const plan = parts[2] || '1month';

      console.log(`[Bot] Processing payment deep link: User=${userId}, Plan=${plan}`);

      // Link account
      if (userId && telegramId && isUUID(userId)) {
        try {
          await query(
            "UPDATE users SET telegram_id = $1, telegram_username = $2, telegram_first_name = $3 WHERE id = $4 AND (telegram_id IS NULL OR telegram_id = $1)",
            [telegramId, telegramUsername, telegramFirstName, userId]
          );
        } catch (e) {
          console.error("Error linking telegram account:", e);
        }
      }

      if (PLAN_PRICES[plan]) {
        bot.sendInvoice(
          chatId,
          PLAN_LABELS[plan],
          `Оплата подписки для пользователя ${userId}. Доступ к профессиональным инструментам анализа рынка.`,
          `payload_${userId}_${plan}`,
          '', // Empty for Stars
          'XTR', // Stars currency
          [{ label: PLAN_LABELS[plan], amount: PLAN_PRICES[plan] }]
        ).catch(err => {
          console.error('[Bot] Error sending invoice:', err.message);
          bot.sendMessage(chatId, `❌ Ошибка при создании счета: ${err.message}\n\nПожалуйста, убедитесь, что в боте включены платежи (Telegram Stars).`);
        });
        return;
      }
    }
  }

  // Handle plain keywords or /start without payload
  const keywords = ['/start', 'старт', 'start', 'оплата', 'меню', 'menu', 'привет', 'hi'];
  if (keywords.some(k => text.includes(k))) {
    sendWelcomeMessage(chatId);
  } else if (!text.startsWith('/start')) {
    // New auto-reply for support as requested by USER
    bot.sendMessage(chatId, 'Здравствуйте! Мы получили ваше сообщение и ответим в ближайшее время. Спасибо за обращение!').catch(e => console.error('Error sending support reply:', e));

    // Proactively save support message to DB if user is linked
    if (telegramId) {
      try {
        const userRes = await query("SELECT id FROM users WHERE telegram_id = $1", [telegramId]);
        if (userRes.rows.length > 0) {
          const userIdForSupport = userRes.rows[0].id;
          const msgContent = msg.text || '[Media/Non-text message]';
          await query(
            "INSERT INTO support_messages (user_id, message, sender_type, sender_role) VALUES ($1, $2, 'user', 'user')",
            [userIdForSupport, msgContent]
          );
          // Sync with users table as well
          await query("UPDATE users SET support_message = $1 WHERE id = $2", [msgContent, userIdForSupport]);
        }
      } catch (err) {
        console.error('[Bot] Support message storage failed:', err);
      }
    }
  }
});

bot.on('callback_query', async (query_data) => {
  const chatId = query_data.message?.chat.id;
  const telegramId = query_data.from?.id;

  if (query_data.data === 'buy_subscription' && chatId) {
    bot.sendMessage(chatId, 'Выберите подходящий тарифный план:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💎 Smarteye Pro (1 месяц) - 1520 ⭐️', callback_data: 'plan_1month' },
          ],
          [
            { text: '💎 Smarteye Pro (6 месяцев) - 7120 ⭐️', callback_data: 'plan_6months' },
          ],
          [
            { text: '🐳 Smarteye Whale (1 год) - 13920 ⭐️', callback_data: 'plan_1year' }
          ]
        ]
      }
    });
    return;
  }

  if (query_data.data && query_data.data.startsWith('plan_') && chatId) {
    const plan = query_data.data.split('_')[1];
    
    // Try to find user by telegramId to personalize or check status
    let userId = 'unknown';
    if (telegramId) {
      const userResult = await query("SELECT id FROM users WHERE telegram_id = $1", [telegramId]);
      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].id;
      }
    }

    if (PLAN_PRICES[plan]) {
      bot.sendInvoice(
        chatId,
        PLAN_LABELS[plan],
        `Доступ к профессиональным инструментам анализа на ${plan === '1month' ? '1 месяц' : plan === '6months' ? '6 месяцев' : '1 год'}.`,
        `payload_${userId}_${plan}`,
        '', // Provider token is empty for Telegram Stars
        'XTR', // Currency for Telegram Stars
        [{ label: PLAN_LABELS[plan], amount: PLAN_PRICES[plan] }]
      ).catch(err => {
        console.error('Error sending invoice:', err);
        bot.sendMessage(chatId, 'Ошибка при создании счета. Пожалуйста, попробуйте позже.');
      });
    }
  }
});

bot.on('pre_checkout_query', (query_data) => {
  bot.answerPreCheckoutQuery(query_data.id, true);
});

bot.on('successful_payment', async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from?.id;
  const paymentPayload = msg.successful_payment?.invoice_payload;
  const telegramChargeId = msg.successful_payment?.telegram_payment_charge_id;
  
  let fulfilled = false;
  
  if (paymentPayload && paymentPayload.startsWith('payload_')) {
    const parts = paymentPayload.split('_');
    let userId = parts[1];
    const plan = parts[2];

    // If userId is unknown, try to find it by telegramId
    if (userId === 'unknown' && telegramId) {
      const userResult = await query("SELECT id FROM users WHERE telegram_id = $1", [telegramId]);
      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].id;
      }
    }

    if (userId !== 'unknown' && PLAN_PRICES[plan]) {
      try {
        const targetUserId = (isUUID(userId) || !telegramId) ? userId : (await query("SELECT id FROM users WHERE telegram_id = $1", [telegramId])).rows[0]?.id || userId;
        
        if (!isUUID(targetUserId)) {
             console.error(`Could not fulfill payment: No user linked to Telegram ID ${telegramId}`);
             bot.sendMessage(chatId, '❌ Ошибка: Не удалось найти пользователя для активации подписки.');
             return;
        }

        try {
          const newExpiryDate = await activateUserSubscription(targetUserId, plan as string, telegramChargeId, telegramId);
          console.log(`Successfully activated subscription ${plan} for user ${targetUserId} via Telegram`);
          bot.sendMessage(chatId, `✨ Оплата прошла успешно! Подписка ${PLAN_LABELS[plan]} активирована до ${newExpiryDate.toLocaleDateString()}.\n\nОбновите страницу в терминале, чтобы изменения вступили в силу.`);
          fulfilled = true;
        } catch (error) {
          console.error('Failed to update subscription after Telegram payment:', error);
          bot.sendMessage(chatId, '❌ Произошла ошибка при активации подписки. Пожалуйста, напишите в поддержку.');
          fulfilled = true; // Still marked as fulfilled so fallback doesn't trigger
        }
      } catch (err) {
        console.error('Telegram payment processing error:', err);
      }
    }
  }
  
  // Generic success message ONLY if first path didn't send a confirmation
  if (!fulfilled) {
    bot.sendMessage(chatId, '✨ Оплата прошла успешно! Если подписка не обновилась в течение нескольких минут, пожалуйста, обратитесь в поддержку.');
  }
});

async function sendVerificationEmail(email: string, code: string, type: 'registration' | 'reset' = 'registration') {
  const host = process.env.SMTP_HOST || 'smtp.mail.ru';
  const port = parseInt(process.env.SMTP_PORT || '465');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.FROM_EMAIL || user;

  if (!user || !pass) {
    const msg = `SMTP credentials missing (User: ${user ? 'OK' : 'MISSING'}, Pass: ${pass ? 'OK' : 'MISSING'}).`;
    console.error(`[SMTP ERROR] ${msg}`);
    throw new Error('Настройки почты (SMTP_USER/SMTP_PASS) не найдены в секретах проекта.');
  }

  const subject = type === 'registration' 
    ? "Код подтверждения регистрации" 
    : "Восстановление пароля";
  
  const title = type === 'registration'
    ? "Подтверждение регистрации"
    : "Восстановление пароля";

  const messageText = type === 'registration'
    ? "Для завершения регистрации в SmartEye Скринер введите следующий код на странице подтверждения:"
    : "Для сброса вашего пароля в SmartEye Скринер введите следующий код:";

  console.log(`[SMTP] Отправка кода ${code} на ${email} (${type}) через ${host}:${port}...`);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false
    }
  });

  try {
    await transporter.sendMail({
      from: `"SmartEye Support" <${from}>`,
      to: email,
      subject: subject,
      text: `${subject}: ${code}. Код действует 15 минут.`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px; margin: 0 auto; background-color: #ffffff; color: #1a1a1a;">
          <h2 style="color: #4F46E5; text-align: center;">${title}</h2>
          <p>Здравствуйте!</p>
          <p>${messageText}</p>
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <h1 style="color: #4F46E5; font-size: 32px; letter-spacing: 10px; margin: 0; font-family: monospace;">${code}</h1>
          </div>
          <p style="font-size: 14px; color: #6b7280;">Код действует 15 минут.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #9ca3af; text-align: center;">Если вы не запрашивали это письмо, просто проигнорируйте его.</p>
        </div>
      `,
    });
    console.log(`[SMTP] Письмо успешно отправлено на ${email}`);
  } catch (error: any) {
    console.error(`[SMTP ERROR] Ошибка при отправке на ${email}:`, error.message);
    throw error;
  }
}

async function activateUserSubscription(userId: string, plan: string, paymentId?: string, telegramId?: number) {
  const planTier = plan === '1year' ? 'whale' : 'pro';
  const months = plan === '1month' ? 1 : plan === '6months' ? 6 : 12;
  const amount = PLAN_PRICES[plan] || 0;

  const userResult = await query("SELECT premium_end_date FROM users WHERE id = $1", [userId]);
  if (userResult.rows.length === 0) {
    throw new Error(`User ${userId} not found`);
  }

  let currentExpiry = userResult.rows[0]?.premium_end_date;
  let startDate = new Date();
  if (currentExpiry && new Date(currentExpiry) > new Date()) {
    startDate = new Date(currentExpiry);
  }

  const newExpiryDate = new Date(startDate);
  newExpiryDate.setMonth(newExpiryDate.getMonth() + months);

  await query(
    "UPDATE users SET subscription_tier = $1, premium_end_date = $2, avatar_tier = $3, telegram_id = COALESCE(telegram_id, $4) WHERE id = $5",
    [planTier, newExpiryDate, plan, telegramId || null, userId]
  );

  await query(
    "INSERT INTO premium_purchases (user_id, plan_tier, amount, expiry_date, telegram_payment_charge_id) VALUES ($1, $2, $3, $4, $5)",
    [userId, planTier, amount, newExpiryDate, paymentId || null]
  );

  // Affiliate Commission Logic
  const userReferrerResult = await query("SELECT referrer_id FROM users WHERE id = $1", [userId]);
  const referrerId = userReferrerResult.rows[0]?.referrer_id;
    if (referrerId) {
      const commission = amount * 0.2; // 20% commission
      await query(
        "INSERT INTO referrals (referrer_id, referred_user_id, status, commission_amount) VALUES ($1, $2, 'paid', $3) ON CONFLICT (referred_user_id) DO UPDATE SET status = 'paid', commission_amount = referrals.commission_amount + $3",
        [referrerId, userId, commission]
      );
      // Update referrer balance and total income
      await query(
        "UPDATE users SET affiliate_balance = COALESCE(affiliate_balance, 0) + $1, total_affiliate_income = COALESCE(total_affiliate_income, 0) + $1, paid_referrals_pending = COALESCE(paid_referrals_pending, 0) + 1 WHERE id = $2",
        [commission, referrerId]
      );
    }

  return newExpiryDate;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust proxy for correct protocol/IP detection behind load balancers
  app.enable('trust proxy');

  // Initialize DB
  try {
    await initializeDatabase();
  } catch (error) {
    console.error("Failed to initialize database:", error);
    // Don't exit, maybe it's already initialized or connection is just slow
  }

  // Ensure public/logos directory exists
  const logosDir = path.join(__dirname, "public", "logos");
  if (!fs.existsSync(logosDir)) {
    fs.mkdirSync(logosDir, { recursive: true });
  }

  // Logo Proxy Route
  app.get("/api/logos/:symbol", async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    
    // 1. Check if logo exists locally (try svg then png)
    const extensions = ["svg", "png", "jpg", "jpeg"];
    for (const ext of extensions) {
      const filePath = path.join(logosDir, `${symbol}.${ext}`);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
    }

    // 2. Try to fetch and save (JIT)
    const sources = [
      { url: `https://bin.bnbstatic.com/static/assets/logos/${symbol}.png`, ext: "png" },
      { url: `https://assets.coincap.io/assets/icons/${symbol.toLowerCase()}@2x.png`, ext: "png" },
      { url: `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${symbol.toLowerCase()}.png`, ext: "png" },
      { url: `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${symbol}/logo.png`, ext: "png" },
      { url: `https://static.okx.com/cdn/oksupport/asset/currency/icon/${symbol.toLowerCase()}.png`, ext: "png" },
      { url: `https://www.gate.io/images/coin_icon/64/${symbol.toLowerCase()}.png`, ext: "png" }
    ];

    for (const source of sources) {
      try {
        const response = await axios.get(source.url, { responseType: "arraybuffer", timeout: 3000 });
        if (response.status === 200) {
          const savePath = path.join(logosDir, `${symbol}.${source.ext}`);
          fs.writeFileSync(savePath, Buffer.from(response.data));
          return res.sendFile(savePath);
        }
      } catch (error) {
        // Continue to next source
      }
    }

    // 3. Fallback to UI Avatars
    res.redirect(`https://ui-avatars.com/api/?name=${symbol}&background=1a1a1a&color=fff&bold=true&font-size=0.33`);
  });

  // Database Routes
  app.get("/api/db/status", async (req, res) => {
    try {
      await query("SELECT 1");
      res.json({ status: "connected" });
    } catch (error) {
      console.error("Database status check failed:", error);
      res.status(500).json({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });

  const JWT_SECRET = process.env.JWT_SECRET || "smarteye-secret-key-123";
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn("WARNING: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set. Google Auth will not work.");
  }

  app.get("/api/auth/google/url", (req, res) => {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account'
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.json({ url: authUrl });
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send("Code missing");

    try {
      const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
      
      // Exchange code for tokens
      const tokenResponse = await axios.post("https://oauth2.googleapis.com/token", {
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });

      const { access_token, id_token } = tokenResponse.data;

      // Get user info
      const userResponse = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const googleUser = userResponse.data;
      const email = googleUser.email;
      const username = googleUser.name || email.split("@")[0];

      // Check if user exists
      let userResult = await query("SELECT * FROM users WHERE email = $1", [email]);
      let user;

      if (userResult.rows.length === 0) {
        // Create user
        const insertResult = await query(
          "INSERT INTO users (email, username, role) VALUES ($1, $2, $3) RETURNING id, email, username, subscription_tier, avatar_tier, premium_end_date, balance, role, referrer_id, created_at",
          [email, username, 'user']
        );
        user = insertResult.rows[0];
      } else {
        user = userResult.rows[0];
        // Remove password from user object if it exists
        delete user.password;
      }

      const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });

      // Send success message to parent window and close popup
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'OAUTH_AUTH_SUCCESS', 
                  payload: { user: ${JSON.stringify(user)}, token: '${token}' } 
                }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Google OAuth error:", error);
      res.status(500).send("Authentication failed");
    }
  });

  // Heleket Payment Routes
  app.post("/api/payments/heleket/create", express.json(), async (req, res) => {
    const { userId, plan, amount } = req.body;
    const HELEKET_API_KEY = process.env.HELEKET_API_KEY;
    const HELEKET_MERCHANT_ID = process.env.HELEKET_MERCHANT_ID || process.env.HELEKET_SHOP_ID;

    if (!HELEKET_API_KEY || !HELEKET_MERCHANT_ID) {
      console.error(`Heleket Config Error - Merchant ID: ${HELEKET_MERCHANT_ID ? 'OK' : 'MISSING'}, API Key: ${HELEKET_API_KEY ? 'OK' : 'MISSING'}`);
      return res.status(500).json({ error: "Heleket configuration missing" });
    }

    try {
      const payload = {
        amount: amount.toString(),
        currency: "USD",
        order_id: `HELEKET_${userId}_${plan}_${Date.now()}`,
        description: `SmartEye Subscription: ${plan}`,
        url_return: `${req.protocol}://${req.get('host')}/profile`,
        url_success: `${req.protocol}://${req.get('host')}/profile?payment=success`,
        url_callback: `${req.protocol}://${req.get('host')}/api/payments/heleket/webhook`,
      };

      const jsonPayload = JSON.stringify(payload);
      const base64Payload = Buffer.from(jsonPayload).toString("base64");
      const sign = crypto.createHash("md5").update(base64Payload + HELEKET_API_KEY).digest("hex");

      const response = await axios.post("https://api.heleket.com/v1/payment", payload, {
        headers: {
          merchant: HELEKET_MERCHANT_ID,
          sign,
          "Content-Type": "application/json",
        },
      });

      const url = response.data?.result?.url;
      if (!url) {
        console.error("Heleket response missing url:", response.data);
        return res.status(500).json({ error: "Heleket returned no payment url" });
      }

      res.json({ url });
    } catch (error: any) {
      console.error("Heleket invoice creation failed:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to create crypto invoice" });
    }
  });

  app.post("/api/payments/heleket/webhook", express.json(), async (req, res) => {
    try {
      const payload = req.body;
      const signature = req.headers['sign'] as string;
      const HELEKET_API_KEY = process.env.HELEKET_API_KEY;

      // Verify signature if possible
      if (signature && HELEKET_API_KEY) {
        const jsonPayload = JSON.stringify(payload);
        const base64Payload = Buffer.from(jsonPayload).toString("base64");
        const expectedSign = crypto.createHash("md5").update(base64Payload + HELEKET_API_KEY).digest("hex");
        
        if (signature !== expectedSign) {
          console.warn("[Heleket Webhook] Invalid signature received");
          // Depending on security requirements, you might want to return 400 here
          // return res.status(400).send("Invalid signature");
        }
      }

      const { order_id, status } = payload;
      console.log(`[Heleket Webhook] Received status ${status} for order ${order_id}`);

      // Heleket statuses: paid, paid_over, confirm_check, wrong_amount
      const successfulStatuses = ['paid', 'paid_over', 'completed'];
      if (successfulStatuses.includes(status)) {
        const parts = order_id.split('_');
        const userId = parts[1];
        const plan = parts[2];

        if (userId && plan) {
          await activateUserSubscription(userId, plan, order_id);
          console.log(`[Heleket Webhook] Subscription activated for user ${userId}, plan ${plan}`);
        }
      }
      res.json({ status: "ok" });
    } catch (error) {
      console.error("[Heleket Webhook] Error processing webhook:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // Yookassa Payment Routes
  app.post("/api/payments/yookassa/create", express.json(), async (req, res) => {
    const { userId, plan, amount } = req.body;
    const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
    const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

    if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
      return res.status(500).json({ error: "Yookassa configuration missing" });
    }

    try {
      const planLabel = PLAN_LABELS[plan] || plan;
      
      // Use predefined RUB prices from global PLAN_PRICES or fall back to calculation
      const rubAmount = PLAN_PRICES[plan] || (amount * 88); 

      const response = await axios.post("https://api.yookassa.ru/v3/payments", {
        amount: {
          value: rubAmount.toFixed(2),
          currency: "RUB"
        },
        confirmation: {
          type: "redirect",
          return_url: `${req.protocol}://${req.get('host')}/profile?payment=success`
        },
        capture: true,
        description: `SmartEye Subscription: ${planLabel}`,
        metadata: {
          userId,
          plan
        }
      }, {
        auth: {
          username: YOOKASSA_SHOP_ID,
          password: YOOKASSA_SECRET_KEY
        },
        headers: {
          'Idempotence-Key': crypto.randomUUID(),
          'Content-Type': 'application/json'
        }
      });

      res.json({ url: response.data.confirmation?.confirmation_url });
    } catch (error: any) {
      console.error("Yookassa payment creation failed:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to create card payment" });
    }
  });

  app.post("/api/payments/yookassa/webhook", express.json(), async (req, res) => {
    try {
      const event = req.body;
      console.log(`[Yookassa Webhook] Received event: ${event.event}`);

      if (event.event === 'payment.succeeded') {
        const payment = event.object;
        const { userId, plan } = payment.metadata;
        const paymentId = payment.id;

        if (userId && plan) {
          await activateUserSubscription(userId, plan, `YOOKASSA_${paymentId}`);
          console.log(`[Yookassa Webhook] Subscription activated for user ${userId}, plan ${plan}`);
        }
      }
      res.status(200).send('OK');
    } catch (error) {
      console.error("[Yookassa Webhook] Error processing webhook:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // Cryptomus Payment Routes
  app.post("/api/payments/cryptomus/create", express.json(), async (req, res) => {
    const { userId, plan, amount } = req.body;
    const CRYPTOMUS_API_KEY = process.env.CRYPTOMUS_API_KEY;
    const CRYPTOMUS_MERCHANT_ID = process.env.CRYPTOMUS_MERCHANT_ID;

    if (!CRYPTOMUS_API_KEY || !CRYPTOMUS_MERCHANT_ID) {
      return res.status(500).json({ error: "Cryptomus configuration missing" });
    }

    try {
      const payload = {
        amount: amount.toString(),
        currency: "USD",
        order_id: `CRYPTOMUS_${userId}_${plan}_${Date.now()}`,
        url_return: `${req.protocol}://${req.get('host')}/profile?payment=success`,
        url_callback: `${req.protocol}://${req.get('host')}/api/payments/cryptomus/webhook`,
        is_test: false // Change to true if testing
      };

      const jsonPayload = JSON.stringify(payload);
      const base64Payload = Buffer.from(jsonPayload).toString('base64');
      const sign = crypto.createHash('md5').update(base64Payload + CRYPTOMUS_API_KEY).digest('hex');

      const response = await axios.post("https://api.cryptomus.com/v1/payment", payload, {
        headers: {
          'merchant': CRYPTOMUS_MERCHANT_ID,
          'sign': sign,
          'Content-Type': 'application/json'
        }
      });

      res.json({ url: response.data.result?.url });
    } catch (error: any) {
      console.error("Cryptomus payment creation failed:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to create crypto invoice" });
    }
  });

  app.post("/api/payments/cryptomus/webhook", express.json(), async (req, res) => {
    try {
      const payload = req.body;
      const { order_id, status } = payload;
      
      console.log(`[Cryptomus Webhook] Received status ${status} for order ${order_id}`);

      // Cryptomus statuses: paid, paid_over, wrong_amount_paid
      if (status === 'paid' || status === 'paid_over') {
        const parts = order_id.split('_');
        const userId = parts[1];
        const plan = parts[2];

        if (userId && plan) {
          await activateUserSubscription(userId, plan, order_id);
          console.log(`[Cryptomus Webhook] Subscription activated for user ${userId}, plan ${plan}`);
        }
      }
      res.json({ status: "ok" });
    } catch (error) {
      console.error("[Cryptomus Webhook] Error processing webhook:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  app.post("/api/auth/register", express.json(), async (req, res) => {
    const { email, password, username, referrerId } = req.body;
    try {
      const existing = await query("SELECT * FROM users WHERE email = $1", [email]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: "User already exists" });
      }

      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // WARNING: Storing passwords in plain text is highly insecure.
      // This was implemented per user request.
      const result = await query(
        "INSERT INTO users (email, password, username, referrer_id, verification_code, verification_code_expires, is_verified) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, username, subscription_tier, avatar_tier, premium_end_date, balance, role, referrer_id, created_at, is_verified",
        [email, password, username || email.split("@")[0], referrerId || null, verificationCode, expires, false]
      );

      const user = result.rows[0];

      // If there's a referrer, create a referral record
      if (referrerId) {
        try {
          await query(
            "INSERT INTO referrals (referrer_id, referred_user_id, status) VALUES ($1, $2, $3) ON CONFLICT (referred_user_id) DO NOTHING",
            [referrerId, user.id, 'unpaid']
          );
        } catch (e) {
          console.error("Failed to create referral record:", e);
        }
      }

      try {
        await sendVerificationEmail(email, verificationCode);
        res.json({ message: "Verification code sent", email: user.email });
      } catch (err: any) {
        console.error("Failed to send verification email:", err);
        res.status(500).json({ 
          error: "Пользователь создан, но не удалось отправить письмо. Проверьте настройки SMTP в настройках приложения или попробуйте позже.", 
          email: user.email,
          emailError: err.message 
        });
      }
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/verify", express.json(), async (req, res) => {
    const { email, code } = req.body;
    try {
      const result = await query(
        "SELECT * FROM users WHERE email = $1 AND verification_code = $2 AND verification_code_expires > NOW()",
        [email, code]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: "Invalid or expired verification code" });
      }

      const user = result.rows[0];
      await query(
        "UPDATE users SET is_verified = true, verification_code = NULL, verification_code_expires = NULL WHERE id = $1",
        [user.id]
      );

      const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
      
      // Fetch updated user
      const updatedUserRes = await query("SELECT id, email, username, subscription_tier, avatar_tier, premium_end_date, balance, role, referrer_id, created_at, is_verified FROM users WHERE id = $1", [user.id]);
      
      res.json({ user: updatedUserRes.rows[0], token });
    } catch (error) {
      console.error("Verification error:", error);
      res.status(500).json({ error: "Verification failed" });
    }
  });

  app.post("/api/auth/resend-code", express.json(), async (req, res) => {
    const { email } = req.body;
    try {
      const result = await query("SELECT * FROM users WHERE email = $1", [email]);
      if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });

      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = new Date(Date.now() + 15 * 60 * 1000);

      await query(
        "UPDATE users SET verification_code = $1, verification_code_expires = $2 WHERE email = $3",
        [verificationCode, expires, email]
      );

      try {
        await sendVerificationEmail(email, verificationCode);
        res.json({ message: "Code reshaped" });
      } catch (err: any) {
        res.status(500).json({ error: "Не удалось отправить код. Ошибка: " + err.message });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to resend code" });
    }
  });

  app.post("/api/auth/reset-password-request", express.json(), async (req, res) => {
    const { email } = req.body;
    try {
      // Case-insensitive lookup
      const result = await query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [email]);
      if (result.rows.length === 0) {
        // Return success even if email not found to prevent user enumeration
        return res.json({ message: "If the email was found, a reset code has been sent." });
      }

      const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = new Date(Date.now() + 15 * 60 * 1000);

      await query(
        "UPDATE users SET verification_code = $1, verification_code_expires = $2 WHERE LOWER(email) = LOWER($3)",
        [resetCode, expires, email]
      );

      try {
        await sendVerificationEmail(email, resetCode, 'reset');
        res.json({ message: "Reset code sent" });
      } catch (err: any) {
        res.status(500).json({ error: "Failed to send reset email: " + err.message });
      }
    } catch (error) {
      res.status(500).json({ error: "Password reset request failed" });
    }
  });

  app.post("/api/auth/reset-password-confirm", express.json(), async (req, res) => {
    const { email, code, newPassword } = req.body;
    try {
      const result = await query(
        "SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND verification_code = $2 AND verification_code_expires > NOW()",
        [email, code]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: "Invalid or expired reset code" });
      }

      const user = result.rows[0];
      await query(
        "UPDATE users SET password = $1, verification_code = NULL, verification_code_expires = NULL, is_verified = true WHERE id = $2",
        [newPassword, user.id]
      );

      res.json({ message: "Password updated successfully" });
    } catch (error) {
      res.status(500).json({ error: "Failed to update password" });
    }
  });

  app.post("/api/auth/login", express.json(), async (req, res) => {
    const { email, password } = req.body;
    try {
      // Case-insensitive email lookup
      const result = await query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [email]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const user = result.rows[0];

      if (!user.password) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      
      // Plain text comparison per user request
      const valid = (password === user.password);
      if (!valid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // If user logs in but wasn't verified, mark as verified
      if (!user.is_verified) {
        await query("UPDATE users SET is_verified = true WHERE id = $1", [user.id]);
        user.is_verified = true;
      }

      const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
      const { password: _p, verification_code: _v, verification_code_expires: _ve, ...userWithoutSensitive } = user;
      res.json({ user: userWithoutSensitive, token });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      const result = await query("SELECT id, email, username, subscription_tier, avatar_tier, premium_end_date, balance, role, referrer_id, telegram_id, telegram_username, telegram_first_name, support_message, created_at FROM users WHERE id = $1", [decoded.userId]);
      if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
      res.json(result.rows[0]);
    } catch (error) {
      console.error("Session check failed:", error);
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // Partner Routes
  app.get("/api/partner/premium-history/:userId", async (req, res) => {
    const { userId } = req.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return res.status(400).json({ error: "Invalid user ID format" });
    }
    try {
      const result = await query(
        "SELECT * FROM premium_purchases WHERE user_id = $1 ORDER BY purchase_date DESC",
        [userId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching premium history:", error);
      res.status(500).json({ error: "Failed to fetch premium history" });
    }
  });

  app.get("/api/partner/referrals/:userId", async (req, res) => {
    const { userId } = req.params;
    console.log(`[Partner] Incoming referrals request for: ${userId}`);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.warn(`[Partner] userId ${userId} is not a valid UUID`);
      return res.status(400).json({ error: "Invalid user ID format" });
    }
    try {
      const result = await query(
        `SELECT r.*, u.email as referred_email, u.username as referred_username, u.created_at as joined_at 
         FROM referrals r 
         JOIN users u ON r.referred_user_id = u.id 
         WHERE r.referrer_id = $1 
         ORDER BY r.created_at DESC`,
        [userId]
      );
      console.log(`[Partner] Found ${result.rows.length} referrals for ${userId}`);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching referrals:", error);
      res.status(500).json({ error: "Failed to fetch referrals" });
    }
  });

  app.post("/api/partner/click/:partnerId", async (req, res) => {
    const { partnerId } = req.params;
    console.log(`[Partner] Click received for partnerId: ${partnerId}`);

    if (!partnerId || !isUUID(partnerId)) {
      console.warn(`[Partner] Invalid partner ID format: ${partnerId}`);
      return res.status(400).json({ error: "Invalid partner ID" });
    }
    try {
      // Check if user exists
      const userResult = await query("SELECT id FROM users WHERE id = $1", [partnerId]);
      if (userResult.rows.length === 0) {
        console.warn(`[Partner] Partner not found in DB: ${partnerId}`);
        return res.status(404).json({ error: "Partner not found" });
      }

      // Upsert click count in affiliate_stats
      const result = await query(
        "INSERT INTO affiliate_stats (user_id, clicks) VALUES ($1, 1) ON CONFLICT (user_id) DO UPDATE SET clicks = affiliate_stats.clicks + 1, updated_at = CURRENT_TIMESTAMP RETURNING clicks",
        [partnerId]
      );
      
      console.log(`[Partner] Click recorded! New total: ${result.rows[0].clicks} for ${partnerId}`);
      res.json({ success: true, clicks: result.rows[0].clicks });
    } catch (error) {
      console.error("[Partner] Click tracking error:", error);
      res.status(500).json({ error: "Failed to track click" });
    }
  });

  app.get("/api/partner/earnings-summary/:userId", async (req, res) => {
    const { userId } = req.params;
    console.log(`[Partner] Incoming earnings summary request for: ${userId}`);
    try {
      let totalEarnings = 0;
      let totalWithdrawn = 0;
      let totalClicks = 0;
      let lastWithdrawDate = null;
      let totalSystemIncome = 0;
      
      let userExt = null;
      
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(userId)) {
        // Check if user is admin
        const userResult = await query("SELECT role, created_at FROM users WHERE id = $1", [userId]);
        const isAdmin = userResult.rows[0]?.role === 'admin';
        
        const earningsResult = await query(
          "SELECT SUM(commission_amount) as total_earnings FROM referrals WHERE referrer_id = $1",
          [userId]
        );
        const withdrawalsResult = await query(
          "SELECT SUM(amount) as total_withdrawn, MAX(created_at) as last_withdraw_date FROM withdrawals WHERE user_id = $1 AND status != 'rejected'",
          [userId]
        );
        const statsResult = await query(
          "SELECT clicks FROM affiliate_stats WHERE user_id = $1",
          [userId]
        );
        
        totalEarnings = parseFloat(earningsResult.rows[0].total_earnings || 0);
        totalWithdrawn = parseFloat(withdrawalsResult.rows[0].total_withdrawn || 0);
        totalClicks = parseInt(statsResult.rows[0]?.clicks || 0);
        lastWithdrawDate = withdrawalsResult.rows[0]?.last_withdraw_date;

        console.log(`[Partner] Data for ${userId}: Earnings=${totalEarnings}, Clicks=${totalClicks}`);

        if (!lastWithdrawDate) {
          lastWithdrawDate = userResult.rows[0]?.created_at;
        }

        // If admin, calculate total system revenue
        if (isAdmin) {
          const systemRevenueResult = await query("SELECT SUM(amount) as total FROM premium_purchases");
          totalSystemIncome = parseFloat(systemRevenueResult.rows[0].total || 0);
        }

        // Get stored values from users table for partnership
        const userExtendedResult = await query(
          "SELECT affiliate_balance, total_affiliate_income, paid_referrals_pending FROM users WHERE id = $1",
          [userId]
        );
        userExt = userExtendedResult.rows[0];
        
        // We can use calculated values or stored values. Let's use stored values for balance if available
        // to match what the user Sees in the "wallet".
        if (userExt) {
          // totalEarnings = parseFloat(userExt.total_affiliate_income || totalEarnings);
          // availableBalance = parseFloat(userExt.affiliate_balance || (totalEarnings - totalWithdrawn));
        }

      } else {
        console.warn(`[Partner] userId ${userId} is not a valid UUID in summary`);
      }
      
      const response = { 
        total_earnings: userExt ? parseFloat(userExt.total_affiliate_income || totalEarnings) : totalEarnings,
        total_withdrawn: totalWithdrawn,
        available_balance: userExt ? parseFloat(userExt.affiliate_balance || (totalEarnings - totalWithdrawn)) : (totalEarnings - totalWithdrawn),
        paid_referrals_pending: userExt ? parseInt(userExt.paid_referrals_pending || 0) : 0,
        total_clicks: totalClicks,
        last_withdraw_date: lastWithdrawDate,
        total_system_income: totalSystemIncome
      };
      res.json(response);
    } catch (error) {
      console.error("Error fetching earnings summary:", error);
      res.status(500).json({ error: "Failed to fetch earnings summary" });
    }
  });

  app.post("/api/partner/simulate-purchase", express.json(), async (req, res) => {
    const { userId, planTier, amount, months } = req.body;
    try {
      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + months);
      
      const result = await query(
        "INSERT INTO premium_purchases (user_id, plan_tier, amount, expiry_date) VALUES ($1, $2, $3, $4) RETURNING *",
        [userId, planTier, amount, expiryDate.toISOString()]
      );
      
      // Update user subscription
      const avatarTier = months === 1 ? '1month' : months === 6 ? '6months' : months === 12 ? '1year' : 'free';
      await query(
        "UPDATE users SET subscription_tier = $1, premium_end_date = $2, avatar_tier = $3 WHERE id = $4",
        [planTier, expiryDate.toISOString(), avatarTier, userId]
      );

      // If user has a referrer, update referral status to 'paid' and add commission
      const userResult = await query("SELECT referrer_id FROM users WHERE id = $1", [userId]);
      const referrerId = userResult.rows[0]?.referrer_id;
      if (referrerId) {
        const commission = amount * 0.2; // 20% commission
        await query(
          "UPDATE referrals SET status = 'paid', commission_amount = commission_amount + $1 WHERE referred_user_id = $2",
          [commission, userId]
        );
        
        // Update referrer balance and total income
        await query(
          "UPDATE users SET affiliate_balance = COALESCE(affiliate_balance, 0) + $1, total_affiliate_income = COALESCE(total_affiliate_income, 0) + $1, paid_referrals_pending = COALESCE(paid_referrals_pending, 0) + 1 WHERE id = $2",
          [commission, referrerId]
        );
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Simulate purchase error:", error);
      res.status(500).json({ error: "Failed to simulate purchase" });
    }
  });

  app.post("/api/partner/withdraw", express.json(), async (req, res) => {
    const { userId, amount, address } = req.body;
    try {
      // Check balance
      const userRes = await query("SELECT affiliate_balance FROM users WHERE id = $1", [userId]);
      const currentBalance = parseFloat(userRes.rows[0]?.affiliate_balance || 0);
      
      if (currentBalance < amount) {
        return res.status(400).json({ error: "Insufficient balance" });
      }

      const result = await query(
        "INSERT INTO withdrawals (user_id, amount, address) VALUES ($1, $2, $3) RETURNING *",
        [userId, amount, address]
      );
      
      // Deduct from balance and reset pending referrals
      await query("UPDATE users SET affiliate_balance = affiliate_balance - $1, paid_referrals_pending = 0 WHERE id = $2", [amount, userId]);

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Withdrawal error:", error);
      res.status(500).json({ error: "Failed to create withdrawal request" });
    }
  });

  app.post("/api/support/message", express.json(), async (req, res) => {
    const { userId, message, senderType = 'user' } = req.body;
    if (!userId || !message) {
      return res.status(400).json({ error: "User ID and message are required" });
    }
    try {
      // Use both columns for maximum compatibility
      const result = await query(
        "INSERT INTO support_messages (user_id, message, sender_type, sender_role) VALUES ($1, $2, $3, $3) RETURNING *",
        [userId, message, senderType]
      );

      // Also update the users table's support_message column just in case
      try {
        await query("UPDATE users SET support_message = $1 WHERE id = $2", [message, userId]);
      } catch (e) {
        console.warn("Failed to update user support_message column:", e);
      }

      // Notify via densitiesWss if possible
      const targetMessage = result.rows[0];
      let broadcastCount = 0;
      densitiesWss.clients.forEach((client: any) => {
        if (client.readyState === 1 && String(client.userId) === String(userId)) {
          client.send(JSON.stringify({
            type: "SUPPORT_MESSAGE_RECEIVED",
            message: targetMessage
          }));
          broadcastCount++;
        }
      });
      console.log(`[Support] Broadcasted message to ${broadcastCount} client(s) for user ${userId}`);

      // Auto-reply ONLY for the very first message from user
      const messageCount = await query("SELECT COUNT(*) FROM support_messages WHERE user_id = $1", [userId]);
      if (parseInt(messageCount.rows[0].count) <= 1) {
        setTimeout(async () => {
          try {
            const autoReplyResult = await query(
              "INSERT INTO support_messages (user_id, message, sender_type, sender_role) VALUES ($1, $2, $3, $3) RETURNING *",
              [userId, "Здравствуйте! Мы получили ваше сообщение и ответим в ближайшее время. Спасибо за обращение!", "admin"]
            );
            const replyMessage = autoReplyResult.rows[0];
            densitiesWss.clients.forEach((client: any) => {
              if (client.readyState === 1 && String(client.userId) === String(userId)) {
                client.send(JSON.stringify({
                  type: "SUPPORT_MESSAGE_RECEIVED",
                  message: replyMessage
                }));
              }
            });
          } catch (e) {
            console.error("Auto-reply error:", e);
          }
        }, 2000);
      }

      res.json(targetMessage);
    } catch (error) {
      console.error("Support message error:", error);
      res.status(500).json({ error: "Failed to send support message" });
    }
  });

  app.get("/api/support/history/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const result = await query(
        "SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC",
        [userId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error("Support history error:", error);
      res.status(500).json({ error: "Failed to fetch support history" });
    }
  });

  // API Routes
  app.get("/api/admin/users", async (req, res) => {
    try {
      const result = await query(`
        SELECT 
          u.*,
          p.plan_tier as subscription_type,
          p.purchase_date as subscription_start,
          p.expiry_date as subscription_end,
          (
            SELECT json_agg(h ORDER BY h.purchase_date DESC)
            FROM premium_purchases h
            WHERE h.user_id = u.id
          ) as subscription_history,
          COALESCE(u.referral_income, 0) as referral_income,
          COALESCE(u.referral_clicks, 0) as referral_clicks,
          (
            SELECT COUNT(*)
            FROM referrals r
            WHERE r.referrer_id = u.id
          ) as total_referrals,
          (
            SELECT json_agg(w ORDER BY w.created_at DESC)
            FROM withdrawals w
            WHERE w.user_id = u.id AND w.status = 'pending'
          ) as pending_withdrawals,
          (
            SELECT json_agg(w ORDER BY w.created_at DESC)
            FROM withdrawals w
            WHERE w.user_id = u.id AND w.status = 'completed'
          ) as withdrawal_history
        FROM users u
        LEFT JOIN (
          SELECT DISTINCT ON (user_id) 
            user_id, plan_tier, purchase_date, expiry_date
          FROM premium_purchases
          ORDER BY user_id, purchase_date DESC
        ) p ON u.id = p.user_id
        ORDER BY u.created_at DESC
      `);
      res.json(result.rows);
    } catch (error) {
      console.error("Admin user fetch error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.get("/api/admin/tables", async (req, res) => {
    try {
      const result = await query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tables" });
    }
  });

  app.get("/api/admin/schema", async (req, res) => {
    try {
      const result = await query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'users'
      `);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch schema" });
    }
  });

  app.post("/api/admin/withdrawals/:id/confirm", async (req, res) => {
    const { id } = req.params;
    try {
      await query("UPDATE withdrawals SET status = 'completed' WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to confirm withdrawal" });
    }
  });

  app.put("/api/admin/users/:id", express.json(), async (req, res) => {
    const { id } = req.params;
    const { email, username, referral_income, subscription_type, subscription_end } = req.body;
    try {
      await query(
        "UPDATE users SET email = $1, username = $2, referral_income = $3 WHERE id = $4",
        [email, username, referral_income || 0, id]
      );
      if (subscription_type || subscription_end) {
        await query(`
          INSERT INTO premium_purchases (user_id, plan_tier, amount, purchase_date, expiry_date)
          VALUES ($1, $2, 0, NOW(), $3)
        `, [id, subscription_type || 'Premium', subscription_end || null]);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.delete("/api/admin/users/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await query("DELETE FROM users WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // Support Chat Unified logic (Broadcasts to user WebSocket)
  app.post("/api/support/messages", express.json(), async (req, res) => {
    const { userId, message } = req.body;
    const senderRole = req.body.senderRole || req.body.sender_role || 'user';
    
    if (!userId || !message) return res.status(400).json({ error: "Missing data" });

    try {
      const result = await query(
        "INSERT INTO support_messages (user_id, message, sender_role, sender_type) VALUES ($1, $2, $3, $3) RETURNING *",
        [userId, message, senderRole]
      );
      
      const targetMessage = result.rows[0];

      // WebSocket broadcast (For REAL-TIME delivery)
      let broadcastCount = 0;
      densitiesWss.clients.forEach((client: any) => {
        if (client.readyState === 1 && String(client.userId) === String(userId)) {
          client.send(JSON.stringify({
            type: "SUPPORT_MESSAGE_RECEIVED",
            message: targetMessage
          }));
          broadcastCount++;
        }
      });
      console.log(`[Support Admin] Broadcasted to ${broadcastCount} client(s) for user ${userId}`);

      res.json(targetMessage);
    } catch (error) {
      console.error("Support API error:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // Admin Support APIs
  app.get("/api/support/sessions", async (req, res) => {
    try {
      const result = await query(`
        SELECT DISTINCT ON (m.user_id) 
          m.user_id, 
          u.email, 
          u.username,
          m.message as last_message, 
          m.created_at as last_message_at,
          (SELECT COUNT(*) FROM support_messages WHERE user_id = m.user_id AND is_read = false AND sender_role = 'user') as unread_count
        FROM support_messages m
        JOIN users u ON m.user_id = u.id
        ORDER BY m.user_id, m.created_at DESC
      `);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch support sessions" });
    }
  });

  app.get("/api/support/messages/:userId", async (req, res) => {
    const { userId } = req.params;
    const { role } = req.query; // admin or user
    try {
      const result = await query(
        "SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC",
        [userId]
      );
      if (role === 'admin') {
        await query(
          "UPDATE support_messages SET is_read = true WHERE user_id = $1 AND sender_role = 'user'",
          [userId]
        );
      }
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.get("/api/users", async (req, res) => {
    try {
      const result = await query(`
        SELECT 
          u.*,
          p.plan_tier as subscription_type,
          p.purchase_date as subscription_start,
          p.expiry_date as subscription_end,
          (
            SELECT json_agg(h ORDER BY h.purchase_date DESC)
            FROM premium_purchases h
            WHERE h.user_id = u.id
          ) as subscription_history,
          COALESCE(u.referral_income, 0) as referral_income,
          COALESCE(u.referral_clicks, 0) as referral_clicks,
          (
            SELECT COUNT(*)
            FROM referrals r
            WHERE r.referrer_id = u.id
          ) as total_referrals,
          (
            SELECT json_agg(w ORDER BY w.created_at DESC)
            FROM withdrawals w
            WHERE w.user_id = u.id AND w.status = 'pending'
          ) as pending_withdrawals,
          (
            SELECT json_agg(w ORDER BY w.created_at DESC)
            FROM withdrawals w
            WHERE w.user_id = u.id AND w.status = 'completed'
          ) as withdrawal_history
        FROM users u
        LEFT JOIN (
          SELECT DISTINCT ON (user_id) 
            user_id, plan_tier, purchase_date, expiry_date
          FROM premium_purchases
          ORDER BY user_id, purchase_date DESC
        ) p ON u.id = p.user_id
        ORDER BY u.created_at DESC
      `);
      res.json(result.rows);
    } catch (error) {
      console.error("Admin user list error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.get("/api/users/:email", async (req, res) => {
    const { email } = req.params;
    try {
      let result = await query("SELECT * FROM users WHERE email = $1", [email]);
      if (result.rows.length === 0) {
        // Create user if not exists
        result = await query(
          "INSERT INTO users (email, username) VALUES ($1, $2) RETURNING *",
          [email, email.split("@")[0]]
        );
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error(`Error fetching/creating user ${email}:`, error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/alerts/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const result = await query("SELECT * FROM alerts WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
      res.json(result.rows);
    } catch (error) {
      console.error(`Error fetching alerts for user ${userId}:`, error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/alerts", express.json(), async (req, res) => {
    const { userId, symbol, price, type } = req.body;
    try {
      const result = await query(
        "INSERT INTO alerts (user_id, symbol, price, type) VALUES ($1, $2, $3, $4) RETURNING *",
        [userId, symbol, price, type]
      );
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/alerts/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await query("DELETE FROM alerts WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/trades/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const result = await query("SELECT * FROM trades WHERE user_id = $1 ORDER BY timestamp DESC", [userId]);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/positions/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const result = await query("SELECT * FROM positions WHERE user_id = $1 ORDER BY timestamp DESC", [userId]);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/positions", express.json(), async (req, res) => {
    const { userId, symbol, exchange, market, side, entryPrice, liquidationPrice, takeProfit, stopLoss, amount, leverage } = req.body;
    try {
      const result = await query(
        "INSERT INTO positions (user_id, symbol, exchange, market, side, entry_price, liquidation_price, take_profit, stop_loss, amount, leverage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *",
        [userId, symbol, exchange, market, side, entryPrice, liquidationPrice, takeProfit, stopLoss, amount, leverage]
      );
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/positions/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await query("DELETE FROM positions WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/pending-orders/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const result = await query("SELECT * FROM pending_orders WHERE user_id = $1 ORDER BY timestamp DESC", [userId]);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/pending-orders", express.json(), async (req, res) => {
    const { userId, symbol, exchange, market, side, limitPrice, initialPrice, amount, leverage } = req.body;
    try {
      const result = await query(
        "INSERT INTO pending_orders (user_id, symbol, exchange, market, side, limit_price, initial_price, amount, leverage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
        [userId, symbol, exchange, market, side, limitPrice, initialPrice, amount, leverage]
      );
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/pending-orders/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await query("DELETE FROM pending_orders WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/trades", express.json(), async (req, res) => {
    const { userId, symbol, side, entryPrice, exitPrice, amount, leverage, pnl } = req.body;
    try {
      const result = await query(
        "INSERT INTO trades (user_id, symbol, side, entry_price, exit_price, amount, leverage, pnl) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
        [userId, symbol, side, entryPrice, exitPrice, amount, leverage, pnl]
      );
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/settings/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const result = await query("SELECT settings FROM user_settings WHERE user_id = $1", [userId]);
      res.json(result.rows[0] || null);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/settings", express.json(), async (req, res) => {
    const { userId, settings } = req.body;
    try {
      await query(
        "INSERT INTO user_settings (user_id, settings) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET settings = $2, updated_at = CURRENT_TIMESTAMP",
        [userId, settings]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Proxy routes for tickers to bypass regional blocks (451)
  app.get("/api/tickers/binance/spot", async (req, res) => {
    try {
      const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
      res.json(response.data);
    } catch (error: any) {
      // Fallback for 451 or other errors
      try {
        const altResponse = await axios.get('https://api.binance.me/api/v3/ticker/24hr');
        res.json(altResponse.data);
      } catch (e) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    }
  });

  app.get("/api/tickers/binance/futures", async (req, res) => {
    try {
      const response = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr');
      res.json(response.data);
    } catch (error: any) {
      try {
        const altResponse = await axios.get('https://fapi.binance.me/fapi/v1/ticker/24hr');
        res.json(altResponse.data);
      } catch (e) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    }
  });

  app.get("/api/tickers/bybit/:category", async (req, res) => {
    const { category } = req.params; // 'spot' or 'linear'
    try {
      const response = await axios.get(`https://api.bybit.com/v5/market/tickers?category=${category}`);
      res.json(response.data);
    } catch (error: any) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Proxy route for individual ticker
  app.get("/api/ticker/binance/:symbol", async (req, res) => {
    const { symbol } = req.params;
    const marketType = req.query.market === 'FUTURES' ? 'FUTURES' : 'SPOT';
    const baseUrl = marketType === 'SPOT' ? 'https://api.binance.com/api/v3/ticker/24hr' : 'https://fapi.binance.com/fapi/v1/ticker/24hr';
    try {
      const response = await axios.get(`${baseUrl}?symbol=${symbol}`);
      res.json(response.data);
    } catch (error: any) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Proxy route for klines
  app.get("/api/klines/:exchange/:market", async (req, res) => {
    const { exchange, market } = req.params;
    const { symbol, interval = '1h', limit = '24' } = req.query;
    try {
      if (exchange === 'binance') {
        const baseUrl = market === 'spot' ? 'https://api.binance.com/api/v3/klines' : 'https://fapi.binance.com/fapi/v1/klines';
        const response = await axios.get(`${baseUrl}?symbol=${symbol}&interval=${interval}&limit=${limit}`);
        res.json(response.data);
      } else {
        const category = market === 'spot' ? 'spot' : 'linear';
        const response = await axios.get(`https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol}&interval=${interval === '1h' ? '60' : interval}&limit=${limit}`);
        res.json(response.data);
      }
    } catch (error: any) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Admin Routes
  // Admin Routes
  app.get("/api/admin/users", async (req, res) => {
    // In a real app, you'd check a JWT token for admin role here
    try {
      const result = await query("SELECT * FROM users ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // AI ROUTES
  let aiInstance: GoogleGenAI | null = null;
  const getAI = () => {
    if (!aiInstance) {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) return null;
      aiInstance = new GoogleGenAI({ 
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    }
    return aiInstance;
  };

  const handleAiError = (error: any, res: express.Response) => {
    console.error("AI Error:", error);
    const errorMessage = error.message || String(error);
    const isQuotaError = errorMessage.includes('429') || 
                        errorMessage.includes('RESOURCE_EXHAUSTED') || 
                        (error.status === 429);
    
    if (isQuotaError) {
      return res.status(429).json({ 
        error: "QUOTA_EXCEEDED", 
        message: "AI quota exceeded. Please try again in a few minutes." 
      });
    }
    res.status(500).json({ error: "AI_ERROR", message: errorMessage });
  };

  app.post("/api/ai/analyze", express.json(), async (req, res) => {
    const { asset, language = 'ru', model = 'gemini-3-flash-preview' } = req.body;
    const ticker = asset.pair.replace(/USDT$|BUSD$|BTC$|ETH$/, '');
    
    const prompt = `
      TARGET ASSET: ${asset.pair} (Ticker: ${ticker}).
      
      STEP 1: Use Google Search to find two specific pages on CoinMarketCap for ${ticker}:
      1. Main Page: https://coinmarketcap.com/currencies/[coin-slug]/
      2. AI Page: https://coinmarketcap.com/cmc-ai/[coin-slug]/what-is/
      
      STEP 2: EXTRACT "In brief" (Source 1):
      - Find the general summary section on the main page.
      - Extract key bullet points about the project.
      
      STEP 3: EXTRACT "Key Factors" (Source 2 from CMC AI):
      - Find the blue-tinted block with lightning bolt icon specifically from the CMC AI section.
      - Extract the numbered "Key Factors" points verbatim.
      
      STEP 4: EXTRACT ALL MARKET METRICS from the page:
      - Current Price, Market Cap, 24h Volume, Circulating Supply, Market Rank, ATH, ATL.
      
      STEP 5: TRANSLATE everything to ${language === 'ru' ? 'Russian' : 'English'}.
      
      OUTPUT JSON:
      {
        "analysis": "Extraction from CoinMarketCap and CMC AI completed.",
        "brief": ["<Source 1 point 1>", "<Source 1 point 2>", "..."],
        "why": ["<Source 2 (CMC AI) point 1>", "<Source 2 (CMC AI) point 2>", "..."],
        "metrics": {
          "price": "<Verbatim Price>",
          "cap": "<Verbatim Market Cap>",
          "volume": "<Verbatim 24h Volume>",
          "supply": "<Verbatim Circulating Supply>",
          "rank": "<Market Rank>",
          "ath": "<All Time High>",
          "atl": "<All Time Low>",
          "news": "<Combined important highlights string>",
          "protocol": "<Detailed 'What is' section>",
          "protocolTitle": "О протоколе ${ticker}"
        },
        "sources": [
          {"title": "CoinMarketCap ${ticker}", "uri": "https://coinmarketcap.com/currencies/${ticker.toLowerCase()}/"},
          {"title": "CMC AI Insights", "uri": "https://coinmarketcap.com/cmc-ai/${ticker.toLowerCase()}/what-is/"}
        ]
      }
    `;

    try {
      const ai = getAI();
      if (!ai) return res.status(503).json({ error: "AI_UNAVAILABLE", message: "AI Service unavailable: apiKey is missing." });

      // Use recommended models for this environment
      const targetModel = 'gemini-3-flash-preview';

      const response = await ai.models.generateContent({
        model: targetModel,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          systemInstruction: `You are a high-precision data extraction tool for Smarteye.
          
          You MUST provide two separate arrays of information:
          1. "brief": General bullet points from the main CoinMarketCap page.
          2. "why": The specific "Key Factors" from the blue CMC AI block (lightning bolt).
          
          CRITICAL RULES:
          1. DO NOT merge these two sources.
          2. EXTRACT VERBATIM where possible.
          3. Fill the "metrics" object with all requested numbers.
          4. Always translate the final output to ${language === 'ru' ? 'Russian' : 'English'}.`,
          tools: [{ googleSearch: {} }],
        },
      });

      const data = JSON.parse(response.text || "{}");
      
      const groundingSources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
        ?.filter(chunk => chunk.web)
        ?.map(chunk => ({
          title: chunk.web?.title || 'Source',
          uri: chunk.web?.uri || ''
        })) || [];

      const result = {
        analysis: data.analysis || "Extraction from CoinMarketCap completed.",
        why: Array.isArray(data.why) ? data.why : [],
        brief: Array.isArray(data.brief) ? data.brief : [],
        metrics: {
          price: data.metrics?.price || '',
          cap: data.metrics?.cap || '',
          volume: data.metrics?.volume || '',
          supply: data.metrics?.supply || '',
          rank: data.metrics?.rank || '',
          ath: data.metrics?.ath || '',
          atl: data.metrics?.atl || '',
          news: data.metrics?.news || '',
          protocol: data.metrics?.protocol || '',
          protocolTitle: data.metrics?.protocolTitle || `О протоколе ${ticker}`
        },
        sources: [...(data.sources || []), ...groundingSources].slice(0, 5)
      };

      res.json(result);
    } catch (error) {
      handleAiError(error, res);
    }
  });

  app.post("/api/ai/ask", express.json(), async (req, res) => {
    const { question, context, language = 'ru' } = req.body;
    const contextStr = Array.isArray(context) 
      ? context.slice(0, 5).map((d: any) => `${d.pair} ${d.side} @ ${d.price}`).join(', ')
      : '';
    const prompt = `Context: ${contextStr}\nQuestion: ${question}\nLanguage: ${language === 'ru' ? 'Russian' : 'English'}.`;

    try {
      const ai = getAI();
      if (!ai) return res.status(503).json({ error: "AI_UNAVAILABLE", message: "Assistant unavailable: apiKey is missing." });

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          systemInstruction: `You are Smarteye Assistant. Answer based on provided data. Respond in ${language === 'ru' ? 'Russian' : 'English'}.`
        }
      });
      res.json({ text: response.text || "I'm sorry, I couldn't generate an answer." });
    } catch (error) {
      handleAiError(error, res);
    }
  });

  app.post("/api/admin/update-user", express.json(), async (req, res) => {
    const { userId, tier, role, avatarTier, premiumEndDate } = req.body;
    try {
      await query(
        "UPDATE users SET subscription_tier = $1, role = $2, avatar_tier = $3, premium_end_date = $4 WHERE id = $5",
        [tier, role, avatarTier || 'free', premiumEndDate || '', userId]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Periodically fetch rank mapping to keep the engine ratings accurate
  let rankMap: Record<string, number> = {
    'BTC': 1, 'ETH': 2, 'SOL': 3, 'BNB': 4, 'XRP': 5, 'ADA': 6, 'DOGE': 7, 'TRX': 8, 'TON': 9, 'LINK': 10,
    'AVAX': 11, 'SHIB': 12, 'BCH': 13, 'DOT': 14, 'NEAR': 15, 'MATIC': 16, 'LTC': 17, 'PEPE': 18, 'ICP': 19, 'KAS': 20,
    'STX': 21, 'UNI': 22, 'RENDER': 23, 'APT': 24, 'RNDR': 23, 'ARB': 25, 'OP': 26, 'SUI': 27, 'FIL': 28, 'ETC': 29, 'HBAR': 30,
    'KASPA': 20, 'FET': 31, 'TIA': 32, 'INJ': 33, 'TAO': 34, 'LDO': 35, 'RUNE': 36, 'JUP': 37, 'BGB': 38, 'MNT': 39, 'PYTH': 40
  };

  const fetchRanks = async () => {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false');
      if (response.status === 200) {
        const data = response.data;
        const mapping: Record<string, number> = {};
        data.forEach((coin: any) => {
          mapping[coin.symbol.toUpperCase()] = coin.market_cap_rank;
        });
        rankMap = { ...rankMap, ...mapping };
        console.log('[Server Engine] Rank mapping updated successfully');
      }
    } catch (error: any) {
      console.error('[Server Engine] Error fetching ranks from CoinGecko:', error.message);
      // Fallback is already initialized
    }
  };
  fetchRanks();
  setInterval(fetchRanks, 60 * 60 * 1000); // Once per hour

  // API Route for ranks
  app.get("/api/ranks", (req, res) => {
    res.json(rankMap || {});
  });

  // API Route for Fear and Greed Index
  app.get("/api/stats/fng", async (req, res) => {
    try {
      const response = await axios.get('https://api.alternative.me/fng/');
      res.json(response.data);
    } catch (error) {
      console.error("[Server] Error fetching FnG:", error);
      res.status(500).json({ error: "Failed to fetch Fear and Greed Index" });
    }
  });

  // API Health
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const httpServer = http.createServer(app);
  
  // Separate WebSocket Servers
  const densitiesWss = new WebSocketServer({ noServer: true });
  const chartsWss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url || '').pathname;

    if (pathname === '/ws/densities') {
      densitiesWss.handleUpgrade(request, socket, head, (ws: any) => {
        densitiesWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/charts') {
      chartsWss.handleUpgrade(request, socket, head, (ws: any) => {
        chartsWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // Global pool for exchange connections
  const globalExchangeSockets = new Map<string, WebSocket>();
  // Track which clients want which exchange data
  const exchangeSubscribers = new Map<string, Set<WebSocket>>();
  // Track subscription timers to avoid overlapping bursts
  const bybitSubscriptionTimers = new Map<string, NodeJS.Timeout[]>();
  // Cache for the latest snapshot of each symbol to support new client connections
  const snapshotCache = new Map<string, any>();
  // Track ticker subscriptions
  const tickerSubscribers = new Map<string, Set<WebSocket>>();
  // Track last message time from exchanges to detect stalls
  const lastExchangeMsgTime = new Map<string, number>();
  // Track forced alternative URLs for Binance to bypass regional blocks (451)
  const forcedUrlForConfig = new Map<string, string>();

  // Initialize Global Server Engine
  const serverEngine = new ServerSmarteyeEngine();

  // Periodically broadcast engine results to /ws/densities clients
  setInterval(() => {
    if (densitiesWss.clients.size > 0) {
      const payload = JSON.stringify({
        type: "ENGINE_UPDATE",
        longs: serverEngine.longs,
        shorts: serverEngine.shorts
      });
      densitiesWss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    }
  }, 1000);

  // Proactively connect to major exchanges on startup to feed the global engine
  const startupConfigs: ExchangeConfig[] = [
    ...getConfigsForMarket('SPOT', 'Binance'),
    ...getConfigsForMarket('FUTURES', 'Binance'),
    ...getConfigsForMarket('SPOT', 'Bybit'),
    ...getConfigsForMarket('FUTURES', 'Bybit')
  ];
  
  startupConfigs.forEach(cfg => {
    // Only fetch if not already in globalExchangeSockets (though here it's empty)
    getExchangeSocket(cfg);
  });

  const BINANCE_SPOT_ALTS = [
    'wss://stream.binance.com:9443/ws',
    'wss://data-stream.binance.com/ws',
    'wss://stream.binance.com:443/ws',
    'wss://stream1.binance.com:9443/ws',
    'wss://stream2.binance.com:9443/ws',
    'wss://stream3.binance.com:9443/ws',
    'wss://stream.binance.me/ws',
    'wss://stream.binance.me:9443/ws',
    'wss://stream.binance.us:9443/ws'
  ];
  const BINANCE_FUTURES_ALTS = [
    'wss://fstream.binance.com/ws',
    'wss://fstream.binance.com:443/ws',
    'wss://fstream-auth.binance.com/ws',
    'wss://fstream1.binance.com/ws',
    'wss://fstream2.binance.com/ws',
    'wss://fstream3.binance.com/ws',
    'wss://fstream.binance.me/ws',
    'wss://fstream.binance.me:443/ws'
  ];

  function getNextBinanceUrl(currentUrl: string, marketType: MarketType): string | null {
    const alts = marketType === 'SPOT' ? BINANCE_SPOT_ALTS : BINANCE_FUTURES_ALTS;
    const currentIndex = alts.indexOf(currentUrl);
    if (currentIndex === -1) return alts[0];
    if (currentIndex + 1 < alts.length) return alts[currentIndex + 1];
    return null; // No more alternatives
  }

  function subscribeToBybit(ws: WebSocket, cfg: any) {
    if (!cfg.symbols || cfg.symbols.length === 0) return;
    
    const configKey = `${cfg.exchange}:${cfg.marketType}`;
    console.log(`[Global WS] Subscribing to Bybit symbols for ${configKey} (Count: ${cfg.symbols.length})`);
    
    // Clear existing timers for this socket to avoid overlapping subscription bursts
    if (bybitSubscriptionTimers.has(configKey)) {
      bybitSubscriptionTimers.get(configKey)?.forEach(t => clearTimeout(t));
    }
    const timers: NodeJS.Timeout[] = [];
    bybitSubscriptionTimers.set(configKey, timers);

    const symbols = cfg.symbols;
    const chunkSize = 10;
    const depth = 50; // Use 50 for both to be safe and consistent
    
    for (let i = 0; i < symbols.length; i += chunkSize) {
      const chunk = symbols.slice(i, i + chunkSize);
      const subMsg = {
        op: 'subscribe',
        args: chunk.map((s: string) => `orderbook.${depth}.${s.toUpperCase()}`),
        req_id: `sub_${Date.now()}_${i}`
      };
      
      const timer = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(subMsg));
          } catch (e) {
            console.error(`[Global WS] Error sending sub to Bybit:`, e);
          }
        }
      }, (i / chunkSize) * 200); // 200ms between chunks
      timers.push(timer);
    }
  }

  function subscribeTickersBybit(ws: WebSocket, exchange: string, marketType: MarketType, tickers: any[]) {
    if (!tickers || tickers.length === 0) return;
    const subMsg = {
      op: 'subscribe',
      args: tickers.map(t => `tickers.${t.symbol.toUpperCase()}`),
      req_id: `sub_tickers_${Date.now()}`
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(subMsg));
    }
  }

  function subscribeToBinance(ws: WebSocket, cfg: any) {
    if (!cfg.subscriptionMessages || cfg.subscriptionMessages.length === 0) return;
    
    const configKey = `${cfg.exchange}:${cfg.marketType}`;
    console.log(`[Global WS] Subscribing to Binance symbols for ${configKey}`);
    
    cfg.subscriptionMessages.forEach((msg: any, i: number) => {
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(msg));
          } catch (e) {
            console.error(`[Global WS] Error sending sub to Binance:`, e);
          }
        }
      }, i * 200);
    });
  }

  function subscribeTickersBinance(ws: WebSocket, exchange: string, marketType: MarketType, tickers: any[]) {
    if (!tickers || tickers.length === 0) return;
    const subMsg = {
      method: "SUBSCRIBE",
      params: tickers.map(t => `${t.symbol.toLowerCase()}@aggTrade`),
      id: Date.now()
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(subMsg));
    }
  }

  function getExchangeSocket(cfg: any) {
    const configKey = `${cfg.exchange}:${cfg.marketType}`;
    
    if (globalExchangeSockets.has(configKey)) {
      const socket = globalExchangeSockets.get(configKey);
      if (socket?.readyState === WebSocket.OPEN) {
        // If already open, we MUST re-subscribe for Bybit to trigger a snapshot for the new client
        // This is critical because the client engine ignores deltas until it gets a snapshot
        if (cfg.exchange.startsWith('Bybit')) {
          subscribeToBybit(socket, cfg);
        } else if (cfg.exchange.startsWith('Binance')) {
          subscribeToBinance(socket, cfg);
        }
        return socket;
      }
      if (socket?.readyState === WebSocket.CONNECTING) {
        return socket;
      }
    }

    console.log(`[Global WS] Creating shared connection for ${configKey} -> ${cfg.wsUrl}`);
    
    let targetUrl = cfg.wsUrl;
    if (cfg.exchange.startsWith('Binance') && forcedUrlForConfig.has(configKey)) {
      targetUrl = forcedUrlForConfig.get(configKey)!;
      console.log(`[Global WS] Using forced alternative URL for ${configKey}: ${targetUrl}`);
    }

    const ws = new WebSocket(targetUrl);
    globalExchangeSockets.set(configKey, ws);
    lastExchangeMsgTime.set(configKey, Date.now());

    // Watchdog for this specific exchange connection
    const exchangeWatchdog = setInterval(() => {
      const lastMsg = lastExchangeMsgTime.get(configKey) || 0;
      // Increased to 45s to be more resilient to temporary stalls
      if (Date.now() - lastMsg > 45000) {
        console.warn(`[Global WS] Stalled connection detected for ${configKey}. Closing...`);
        ws.terminate();
        clearInterval(exchangeWatchdog);
      }
    }, 10000);

    ws.on("open", () => {
      console.log(`[Global WS] Shared connection OPEN for ${configKey}`);
      if (cfg.exchange.startsWith('Bybit')) {
        subscribeToBybit(ws, cfg);
      } else if (cfg.exchange.startsWith('Binance')) {
        subscribeToBinance(ws, cfg);
      }
    });

    ws.on("message", (data) => {
      lastExchangeMsgTime.set(configKey, Date.now());
      
      try {
        const rawData = data.toString();
        // Filter out control messages to save bandwidth
        if (rawData.includes('"op":"pong"') || rawData.includes('"ret_msg":"pong"')) return;
        if (rawData.includes('"success":true') && rawData.includes('"op":"subscribe"')) return;

        const parsed = JSON.parse(rawData);

        // Determine if this is ticker data
        let isTicker = false;
        if (cfg.exchange.startsWith('Bybit')) {
          isTicker = parsed.topic?.startsWith('tickers');
        } else if (cfg.exchange.startsWith('Binance')) {
          const eventType = parsed.e || (parsed.data && parsed.data.e);
          isTicker = eventType === '24hrTicker' || eventType === 'aggTrade' || eventType === 'trade';
        }

        // Feed to global engine for server-side processing (only if it's depth data)
        if (!isTicker) {
          serverEngine.updateData(cfg.exchange, cfg.marketType, parsed);
        }
        
        const subscribers = exchangeSubscribers.get(configKey);
        const tickers = tickerSubscribers.get(configKey);
        
        if ((subscribers && subscribers.size > 0) || (tickers && tickers.size > 0)) {
          if (isTicker) {
            const cleanExchange = cfg.exchange.replace(':TICKERS', '');
            const message = JSON.stringify({
              type: "EXCHANGE_DATA",
              dataType: "TICKER",
              exchange: cleanExchange,
              marketType: cfg.marketType,
              data: parsed
            });
            tickers?.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                // Ensure the client is on the charts connection if it's ticker data
                if (chartsWss.clients.has(client)) {
                  client.send(message);
                }
              }
            });
            return;
          }

          // Cache Bybit snapshots
          if (cfg.exchange.startsWith('Bybit') && parsed.type === 'snapshot' && parsed.topic) {
            snapshotCache.set(`${configKey}:${parsed.topic}`, parsed);
          }
          
          // Cache Binance messages (treat as snapshots for new clients)
          if (cfg.exchange.startsWith('Binance')) {
            const symbol = parsed.s || (parsed.data && parsed.data.s);
            if (symbol) {
              snapshotCache.set(`${configKey}:${symbol.toUpperCase()}`, parsed);
            }
          }

          // Wrap the raw data in our protocol
          const message = JSON.stringify({
            type: "EXCHANGE_DATA",
            dataType: "DEPTH",
            exchange: cfg.exchange,
            marketType: cfg.marketType,
            data: parsed
          });
          
          subscribers?.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              // Ensure the client is on the densities connection if it's depth data
              if (densitiesWss.clients.has(client)) {
                client.send(message);
              }
            }
          });
        }
      } catch (e) {
        // Ignore malformed JSON or other parsing errors
      }
    });

    ws.on("close", () => {
      console.warn(`[Global WS] Shared connection CLOSED for ${configKey}. Reconnecting in 5s...`);
      globalExchangeSockets.delete(configKey);
      lastExchangeMsgTime.delete(configKey);
      clearInterval(exchangeWatchdog);

      // Notify all subscribers about the disconnect
      const subscribers = exchangeSubscribers.get(configKey);
      if (subscribers && subscribers.size > 0) {
        const disconnectPayload = JSON.stringify({
          type: "EXCHANGE_ERROR",
          exchange: cfg.exchange,
          marketType: cfg.marketType,
          message: "Connection lost to exchange. Reconnecting...",
          isRegionalBlock: false,
          isDisconnected: true
        });
        subscribers.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            // Only send to density clients who are interested in depth
            if (densitiesWss.clients.has(client)) {
              client.send(disconnectPayload);
            }
          }
        });
      }

      // Clear cache for this exchange on close to avoid stale data
      const prefix = `${configKey}:`;
      for (const key of snapshotCache.keys()) {
        if (key.startsWith(prefix)) snapshotCache.delete(key);
      }

      if (bybitSubscriptionTimers.has(configKey)) {
        bybitSubscriptionTimers.get(configKey)?.forEach(t => clearTimeout(t));
        bybitSubscriptionTimers.delete(configKey);
      }
      
      setTimeout(() => {
        const subs = exchangeSubscribers.get(configKey);
        const isStartupConfig = startupConfigs.some(c => `${c.exchange}:${c.marketType}` === configKey);
        
        if (isStartupConfig || (subs && subs.size > 0)) {
          getExchangeSocket(cfg);
        }
      }, 5000);
    });

    ws.on("error", (err) => {
      const errorMessage = err.message;
      const is451 = errorMessage.includes('451');
      console.error(`[Global WS] Shared connection ERROR for ${configKey}:`, errorMessage);
      
      if (is451 && cfg.exchange.startsWith('Binance')) {
        const currentUrl = ws.url;
        const nextUrl = getNextBinanceUrl(currentUrl, cfg.marketType);
        if (nextUrl) {
          console.warn(`[Global WS] Regional block (451) for ${configKey} at ${currentUrl}. Trying alternative: ${nextUrl}`);
          forcedUrlForConfig.set(configKey, nextUrl);
          ws.terminate(); // This will trigger 'close' and then 'getExchangeSocket' will be called with timeout
          return;
        } else {
          console.error(`[Global WS] All Binance alternatives for ${configKey} failed with 451 code.`);
          const subscribers = exchangeSubscribers.get(configKey);
          if (subscribers && subscribers.size > 0) {
            const errorPayload = JSON.stringify({
              type: "EXCHANGE_ERROR",
              exchange: cfg.exchange,
              marketType: cfg.marketType,
              message: "ALL_ALTERNATIVES_FAILED",
              isRegionalBlock: true,
              isDisconnected: true
            });
            subscribers.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                if (densitiesWss.clients.has(client)) {
                  client.send(errorPayload);
                }
              }
            });
          }
          return;
        }
      }

      // Notify all subscribers about the error
      const subscribers = exchangeSubscribers.get(configKey);
      if (subscribers && subscribers.size > 0) {
        const errorPayload = JSON.stringify({
          type: "EXCHANGE_ERROR",
          exchange: cfg.exchange,
          marketType: cfg.marketType,
          message: errorMessage,
          isRegionalBlock: is451,
          isDisconnected: true
        });
        subscribers.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            if (densitiesWss.clients.has(client)) {
              client.send(errorPayload);
            }
          }
        });
      }
    });

    // Heartbeat
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        if (cfg.exchange.startsWith('Bybit')) {
          ws.send(JSON.stringify({ op: 'ping' }));
        } else if (cfg.exchange.startsWith('Binance')) {
          ws.ping(); 
        }
      } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        clearInterval(pingInterval);
      }
    }, 20000);

    return ws;
  }

  // Densities connection handler
  densitiesWss.on("connection", (clientWs: any) => {
    console.log("[WS Densities] Client connected");
    const clientSubscriptions = new Set<string>();

    clientWs.on("message", (message) => {
      try {
        const payload = JSON.parse(message.toString());
        
        if (payload.type === "IDENTIFY") {
          clientWs.userId = payload.userId;
          console.log(`[WS Support] Client identified as ${payload.userId}`);
          
          query("UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1", [payload.userId]).catch(err => {
            console.error("Failed to update is_online status:", err);
          });
          return;
        }

        if (payload.type === "CONNECT_EXCHANGES") {
          const configs = payload.configs;
          
          clientSubscriptions.forEach(key => {
            exchangeSubscribers.get(key)?.delete(clientWs);
          });
          clientSubscriptions.clear();

          configs.forEach((cfg: any) => {
            const configKey = `${cfg.exchange}:${cfg.marketType}`;
            clientSubscriptions.add(configKey);
            
            if (!exchangeSubscribers.has(configKey)) {
              exchangeSubscribers.set(configKey, new Set());
            }
            exchangeSubscribers.get(configKey)!.add(clientWs);
            
            const ws = getExchangeSocket(cfg);

            if (cfg.exchange.startsWith('Bybit') || cfg.exchange.startsWith('Binance')) {
              const prefix = `${configKey}:`;
              snapshotCache.forEach((snapshot, key) => {
                if (key.startsWith(prefix)) {
                  clientWs.send(JSON.stringify({
                    type: "EXCHANGE_DATA",
                    dataType: "DEPTH",
                    exchange: cfg.exchange,
                    marketType: cfg.marketType,
                    data: snapshot
                  }));
                }
              });
            }
          });
        }
      } catch (e) {
        console.error("[WS Densities] Error parsing message:", e);
      }
    });

    const heartbeatInterval = setInterval(() => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "HEARTBEAT", timestamp: Date.now() }));
      }
    }, 2000);

    clientWs.on("close", () => {
      console.log(`[WS Densities] Client disconnected: ${clientWs.userId || 'anonymous'}`);
      if (clientWs.userId) {
        query("UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1", [clientWs.userId]).catch(err => {
          console.error("Failed to update offline status:", err);
        });
      }
      clearInterval(heartbeatInterval);
      clientSubscriptions.forEach(key => {
        exchangeSubscribers.get(key)?.delete(clientWs);
      });
    });
  });

  // Charts connection handler
  chartsWss.on("connection", (clientWs: any) => {
    console.log("[WS Charts] Client connected");
    const clientSubscriptions = new Set<string>();

    clientWs.on("message", (message) => {
      try {
        const payload = JSON.parse(message.toString());
        
        if (payload.type === "SUBSCRIBE_TICKERS") {
          const tickers = payload.tickers;
          tickers.forEach((t: any) => {
            const configKey = `${t.exchange}:${t.marketType}`;
            
            // For Binance, use a separate socket for tickers to avoid network congestion from depth streams
            const tickerConfigKey = t.exchange.startsWith('Binance') ? `${configKey}:TICKERS` : configKey;
            
            if (!tickerSubscribers.has(tickerConfigKey)) {
              tickerSubscribers.set(tickerConfigKey, new Set());
            }
            tickerSubscribers.get(tickerConfigKey)!.add(clientWs);
            clientSubscriptions.add(tickerConfigKey);

            let ws = globalExchangeSockets.get(tickerConfigKey);
            
            if (!ws || ws.readyState !== WebSocket.OPEN) {
              const baseUrl = t.exchange.startsWith('Binance') 
                ? (t.marketType === 'SPOT' ? 'wss://stream.binance.com:9443' : 'wss://fstream.binance.com')
                : (t.marketType === 'SPOT' ? 'wss://stream.bybit.com/v5/public/spot' : 'wss://stream.bybit.com/v5/public/linear');
              
              const cfg = {
                exchange: t.exchange + (t.exchange.startsWith('Binance') ? ':TICKERS' : ''),
                marketType: t.marketType,
                wsUrl: t.exchange.startsWith('Binance') ? `${baseUrl}/ws` : baseUrl,
                subscriptionMessages: []
              };
              ws = getExchangeSocket(cfg);
            }

            if (ws) {
              if (t.exchange.startsWith('Bybit')) {
                subscribeTickersBybit(ws, t.exchange, t.marketType, [t]);
              } else if (t.exchange.startsWith('Binance')) {
                subscribeTickersBinance(ws, t.exchange, t.marketType, [t]);
              }
            }
          });
        }

        if (payload.type === "UNSUBSCRIBE_TICKERS") {
          const tickers = payload.tickers;
          tickers.forEach((t: any) => {
            const configKey = `${t.exchange}:${t.marketType}`;
            const tickerConfigKey = t.exchange.startsWith('Binance') ? `${configKey}:TICKERS` : configKey;
            tickerSubscribers.get(tickerConfigKey)?.delete(clientWs);
          });
        }
      } catch (e) {
        console.error("[WS Charts] Error parsing message:", e);
      }
    });

    const heartbeatInterval = setInterval(() => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "HEARTBEAT", timestamp: Date.now() }));
      }
    }, 2000);

    clientWs.on("close", () => {
      console.log("[WS Charts] Client disconnected");
      clearInterval(heartbeatInterval);
      clientSubscriptions.forEach(key => {
        tickerSubscribers.get(key)?.delete(clientWs);
      });
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
