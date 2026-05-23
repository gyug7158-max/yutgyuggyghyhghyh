import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Shield, Lock, Eye, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#050505] text-white pt-24 pb-12 px-6">
      <div className="max-w-4xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-8 group">
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
          <span>На главную</span>
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#0c0c0e] border border-white/5 rounded-3xl p-8 md:p-12 shadow-2xl backdrop-blur-xl"
        >
          <div className="flex items-center gap-4 mb-8">
            <div className="p-3 bg-blue-500/10 rounded-2xl">
              <Shield className="text-blue-400" size={32} />
            </div>
            <h1 className="text-3xl font-black uppercase tracking-tighter">Политика конфиденциальности</h1>
          </div>

          <div className="space-y-8 text-gray-400 leading-relaxed font-medium">
            <section>
              <h2 className="text-white text-xl font-bold mb-4 flex items-center gap-2">
                <Lock size={18} className="text-blue-400" />
                1. Сбор информации
              </h2>
              <p>
                Мы собираем только ту информацию, которая необходима для предоставления сервиса SmartEye: 
                адрес электронной почты (при регистрации через Google или вручную) и технические данные о подписке. 
                Мы не храним данные ваших банковских карт или пароли в открытом виде.
              </p>
            </section>

            <section>
              <h2 className="text-white text-xl font-bold mb-4 flex items-center gap-2">
                <Eye size={18} className="text-blue-400" />
                2. Использование данных
              </h2>
              <p>
                Ваши данные используются исключительно для:
              </p>
              <ul className="list-disc pl-6 mt-2 space-y-2">
                <li>Идентификации вас в системе и предоставления доступа к PRO-функциям.</li>
                <li>Обеспечения работы личного кабинета и партнерской программы.</li>
                <li>Технической поддержки и ответов на ваши запросы.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-white text-xl font-bold mb-4 flex items-center gap-2">
                <FileText size={18} className="text-blue-400" />
                3. Передача третьим лицам
              </h2>
              <p>
                Мы не продаем и не передаем ваши личные данные третьим лицам. 
                Для обработки платежей используются проверенные сторонние сервисы (ЮKassa, Cryptomus), 
                которые работают в соответствии со своими политиками безопасности.
              </p>
            </section>

            <section className="pt-8 border-t border-white/5 text-sm">
              <p>Последнее обновление: 21 апреля 2026 г.</p>
              <p>Контакт для связи: smarteyepro@mail.ru</p>
            </section>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
