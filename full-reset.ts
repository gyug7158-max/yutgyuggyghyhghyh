import { query } from './src/lib/db';

async function fullReset() {
  const email = 'pigulinaviktoria200@gmail.com';
  try {
    const userRes = await query("SELECT id FROM users WHERE email = $1", [email]);
    if (userRes.rows.length === 0) {
      console.log('User not found');
      return;
    }
    const userId = userRes.rows[0].id;

    // 1. Сбрасываем баланс в 0
    await query('UPDATE users SET balance = 0 WHERE id = $1', [userId]);
    
    // 2. Удаляем все торговые сделки (чтобы PnL обнулился)
    await query('DELETE FROM trades WHERE user_id = $1', [userId]);

    // 3. Сбрасываем партнерку (клики, рефералы)
    await query('DELETE FROM referrals WHERE referrer_id = $1', [userId]);
    await query('UPDATE affiliate_stats SET clicks = 0 WHERE user_id = $1', [userId]);

    console.log('SUCCESS: All balances and trading history for pigulinaviktoria200@gmail.com have been reset to 0.');
  } catch (err) {
    console.error('ERROR during full reset:', err);
  }
}

fullReset();
