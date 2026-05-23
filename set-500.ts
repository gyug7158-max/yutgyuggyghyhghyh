import { query } from './src/lib/db';

async function setBalance() {
  const email = 'pigulinaviktoria200@gmail.com';
  try {
    await query('UPDATE users SET balance = 500 WHERE email = $1', [email]);
    console.log('SUCCESS: Wallet balance set to +500.00');
  } catch (err) {
    console.error('ERROR during update:', err);
  }
}

setBalance();
