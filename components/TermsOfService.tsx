import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Book, Scale, Zap, Info } from 'lucide-react';
import { Link } from 'react-router-dom';

const TermsOfService: React.FC = () => {
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
            <div className="p-3 bg-purple-500/10 rounded-2xl">
              <Book className="text-purple-400" size={32} />
            </div>
            <h1 className="text-3xl font-black uppercase tracking-tighter">Пользовательское соглашение</h1>
          </div>

          <div className="space-y-8 text-gray-400 leading-relaxed font-medium">
            <section>
              <h2 className="text-white text-xl font-bold mb-4 flex items-center gap-2">
                <Scale size={18} className="text-purple-400" />
                1. Описание сервиса
              </h2>
              <p>
                SmartEyePro предоставляет аналитическую информацию о крипторынке в реальном времени. 
                Сервис не дает финансовых советов. Все торговые решения пользователь принимает самостоятельно на свой страх и риск.
              </p>
            </section>

            <section>
              <h2 className="text-white text-xl font-bold mb-4 flex items-center gap-2">
                <Zap size={18} className="text-purple-400" />
                2. Подписка и оплата
              </h2>
              <p>
                Доступ к расширенным функциям (PRO/Whale) предоставляется на основе платной подписки. 
                Возврат средств после активации подписки не предусмотрен, так как доступ к закрытым данным предоставляется мгновенно.
              </p>
            </section>

            <section>
              <h2 className="text-white text-xl font-bold mb-4 flex items-center gap-2">
                <Info size={18} className="text-purple-400" />
                3. Ответственность
              </h2>
              <p>
                Мы стремимся к максимальной точности данных, но не несем ответственности за возможные задержки 
                котировок со стороны бирж или технические ошибки в работе скринера. 
                Пользователь понимает, что торговля криптовалютой сопряжена с высокими рисками.
              </p>
            </section>

            <section className="pt-8 border-t border-white/5 text-sm">
              <p>SmartEyePro &copy; 2026. Все права защищены.</p>
            </section>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default TermsOfService;
