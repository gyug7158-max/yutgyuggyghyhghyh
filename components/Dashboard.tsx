
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import Table from './Table';
import MarketScreener, { MarketCoin, FavoriteStar, CustomUndoIcon, CustomRedoIcon } from './MarketScreener';
import { AIBookModal } from './AIBookModal';
import { ExchangeLogo } from './UI/Shared';
import { BINANCE_ICON, BYBIT_ICON } from '../src/constants';

import { ChartBlock } from './ChartBlock';

const MemoTable = React.memo(Table);
const MemoMarketScreener = React.memo(MarketScreener);
import { MiniChart } from './UI/MiniChart';
import { RowData, SettingsState, ExchangeSelection, MarketType, ExchangeConfig, STORAGE_PREFIX, DEFAULT_SETTINGS, getConfigsForMarket, DBUser } from '../models';
import { SmarteyeEngineService, CONFIG } from '../services/smarteye-engine.service';
import { User, Settings, ChevronDown, LayoutGrid, Check, Globe, TrendingUp, RotateCcw, Star, Loader2, ChevronUp, BrainCircuit, ArrowUp, ArrowDown, BarChart2, Rewind, X, Maximize, Minimize, LogOut, Volume2, Info, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Logo } from './UI/Icons';
import { Language, translations } from '../src/translations';
import { Link } from 'react-router-dom';
import { MarketSidebar } from './MarketSidebar';
import { SubscriptionAvatar } from './UI/SubscriptionAvatar';
import { SubscriptionPrompt } from './UI/SubscriptionPrompt';
import { apiService } from '../services/api.service';
import { simulatorService } from '../services/trading-simulator.service';

import { LanguageSwitcher } from '../src/components/UI/LanguageSwitcher';

import confetti from 'canvas-confetti';

const DEFAULT_COIN: MarketCoin = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  price: 0,
  change24h: 0,
  volume24h: 0,
  market: 'FUTURES',
  exchange: 'Binance',
  logo: '/api/logos/BTC'
};

const isDensityExcluded = (symbol: string, exchange: string, marketType: string) => {
  const baseAsset = symbol.replace('USDT', '');
  const isBinance = exchange.includes('Binance');
  const isBybit = exchange.includes('Bybit');
  const isFutures = marketType === 'FUTURES';
  const isSpot = marketType === 'SPOT';

  if (isBinance) {
    const allExcl = ['NEAR', 'AVAX', 'BCH', 'TAO', 'SHIB', 'RENDER', 'OP', 'FIL', 'INJ', 'AXS', 'LTC', 'SUI', 'POL', 'AAVE'];
    if (allExcl.includes(baseAsset)) return true;
    if (isFutures && baseAsset === 'ONDO') return true;
    if (isSpot && (baseAsset === 'ICP' || baseAsset === 'PENDLE')) return true;
  }
  
  if (isBybit) {
    const allExcl = ['NEAR', 'STX', 'STRK', 'PEPE', 'AAVE'];
    if (allExcl.includes(baseAsset)) return true;
    const futExcl = ['AVAX', 'BCH', 'LTC', 'GALA', 'ENA', 'ONDO', 'SUI', '1000BONK', '1000FLOKI', 'SEI'];
    if (isFutures && futExcl.includes(baseAsset)) return true;
    const spotExcl = ['RENDER', 'OP'];
    if (isSpot && spotExcl.includes(baseAsset)) return true;
  }
  
  return false;
};

const getDrawingKey = (coin: MarketCoin | null) => {
  if (!coin) return '';
  return `${coin.exchange}:${coin.market}:${coin.symbol}`;
};

const Dashboard: React.FC<{ 
  onNavigateToProfile: (tab?: string, plan?: string) => void;
  onLogout: () => void;
  language: Language;
  setLanguage: React.Dispatch<React.SetStateAction<Language>>;
  engine: SmarteyeEngineService;
  avatarTier: 'free' | '1month' | '6months' | '1year';
  subscriptionTier: 'free' | 'pro' | 'whale';
  dbUser: DBUser | null;
  activeTab: 'screener' | 'market' | 'top_movers';
  setActiveTab: (tab: 'screener' | 'market' | 'top_movers') => void;
  refreshUser: () => Promise<void>;
  onAuthRequired?: () => void;
  showToast?: (message: string, type: any) => void;
  isAuthModalOpen?: boolean;
}> = ({ onNavigateToProfile, onLogout, language, setLanguage, engine, avatarTier, subscriptionTier, dbUser, activeTab, setActiveTab, refreshUser, onAuthRequired, showToast, isAuthModalOpen }) => {
  const t = translations[language];
  const isInitializing = useRef(true);

  // Dedicated component for individual Top Mover cards to manage their own timeframe state
  const TopMoverCard = useMemo(() => {
    return ({ coin, onSelect }: { coin: MarketCoin, onSelect: (c: MarketCoin) => void }) => {
      const [timeframe, setTimeframe] = useState('5m');
      const [isHovered, setIsHovered] = useState(false);
      
      const timeframes = [
        { label: '1m', value: '1m' },
        { label: language === 'ru' ? '5м' : '5m', value: '5m' },
        { label: language === 'ru' ? '15м' : '15m', value: '15m' },
        { label: language === 'ru' ? '1ч' : '1h', value: '1h' },
        { label: language === 'ru' ? '4ч' : '4h', value: '4h' },
        { label: language === 'ru' ? '1д' : '1d', value: '1d' }
      ];

      return (
        <div 
          className="bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden flex flex-col group hover:border-purple-500/30 transition-all duration-300 h-full relative"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Floating Timeframe Selector on Hover */}
          <div className={`absolute top-10 left-1/2 -translate-x-1/2 z-[100] transition-all duration-300 pointer-events-none ${isHovered ? 'opacity-100 translate-y-0 translate-x-[-50%] scale-100' : 'opacity-0 -translate-y-2 translate-x-[-50%] scale-95'}`}>
            <div className="flex items-center bg-[#151515]/90 backdrop-blur-xl border border-white/10 p-0.5 rounded-lg shadow-2xl pointer-events-auto">
              {timeframes.map((tf) => (
                <button
                  key={tf.value}
                  onClick={() => setTimeframe(tf.value)}
                  className={`px-2 py-1 text-[9px] font-black uppercase rounded-md transition-all ${
                    timeframe === tf.value 
                    ? 'bg-purple-500/20 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.2)]' 
                    : 'text-white/40 hover:text-white/60 hover:bg-white/5'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between px-2 py-0.5 bg-[#0d0d0d] border-b border-white/5 shrink-0 z-10">
            <div className="flex items-center gap-1.5">
              <div className="w-3.5 h-3.5 rounded-full border border-white/10 flex items-center justify-center bg-black p-0.5 overflow-hidden">
                <img src={`/api/logos/${coin.baseAsset.toUpperCase()}`} className="w-full h-full object-contain" alt="" />
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest text-white/80">{coin.baseAsset}</span>
              <span className={`text-[9px] font-black font-mono ${coin.change24h >= 0 ? 'text-[#00ff88]' : 'text-[#ff3355]'}`}>
                {coin.change24h >= 0 ? '+' : ''}{coin.change24h.toFixed(2)}%
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-black text-white/30 uppercase tracking-tighter">{coin.exchange}</span>
              <button 
                onClick={() => onSelect(coin)}
                className="p-1 hover:bg-white/10 rounded transition-colors group/btn"
              >
                <Maximize size={9} className="text-gray-500 group-hover/btn:text-white transition-colors" />
              </button>
            </div>
          </div>
          
          <div className="flex-1 relative overflow-hidden">
            <MiniChart 
              symbol={coin.symbol}
              exchange={coin.exchange}
              marketType={coin.market}
              timeframe={timeframe}
              isLong={coin.change24h >= 0}
              price={coin.price}
              activeTool={null}
              drawings={[]}
              onDrawingsChange={() => {}}
              magnetEnabled={false}
              isReplayMode={false}
              isPlaying={false}
              replaySpeed={1000}
              onHistoryChange={() => {}}
              hideToolbar={true}
            />
          </div>
        </div>
      );
    };
  }, [language]);

  // New component for Top Movers inside Dashboard to have access to types and translations
  const TopMoversView = useMemo(() => {
    return ({ data, onSelectCoin }: { data: MarketCoin[], onSelectCoin: (c: MarketCoin) => void }) => {
      const [currentPage, setCurrentPage] = useState(1);
      const itemsPerPage = 9;

      const movers = [...data]
        .filter(c => c.exchange === 'Bybit')
        .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));

      const totalPages = Math.ceil(movers.length / itemsPerPage);
      const currentMovers = movers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

      if (movers.length === 0) {
        return (
          <div className="flex-1 flex items-center justify-center text-white/20 uppercase font-black tracking-widest text-sm">
            <Loader2 className="animate-spin mr-2" />
            {language === 'ru' ? 'Загрузка активов Bybit...' : 'Loading Bybit assets...'}
          </div>
        );
      }

      const goToPage = (p: number) => {
        setCurrentPage(Math.max(1, Math.min(totalPages, p)));
      };

      return (
        <div className="flex flex-col h-full w-full relative overflow-hidden bg-black">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 grid-rows-[repeat(9,minmax(0,1fr))] md:grid-rows-[repeat(5,minmax(0,1fr))] lg:grid-rows-[repeat(3,minmax(0,1fr))] gap-[1px] p-0 flex-1 h-full w-full overflow-hidden">
            {currentMovers.map((coin, idx) => (
              <TopMoverCard 
                key={`${coin.exchange}-${coin.symbol}-${idx}`} 
                coin={coin} 
                onSelect={onSelectCoin} 
              />
            ))}
          </div>

          {/* Pagination UI - Absolute Bottom Right Corner */}
          <div className="absolute bottom-0.5 right-0.5 z-[1000] hidden md:block">
            <div className="flex items-center bg-[#0d0d0d]/95 backdrop-blur-2xl border border-white/10 p-1 rounded-lg shadow-[0_0_40px_rgba(0,0,0,0.8)] gap-0.5 scale-90 origin-bottom-right">
              <button 
                onClick={() => goToPage(1)}
                disabled={currentPage === 1}
                className="p-2 text-white/30 hover:text-white disabled:opacity-5 disabled:cursor-not-allowed transition-all hover:bg-white/5 rounded-lg"
              >
                <ChevronsLeft size={16} strokeWidth={2.5} />
              </button>
              <button 
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-2 text-white/30 hover:text-white disabled:opacity-5 disabled:cursor-not-allowed transition-all hover:bg-white/5 rounded-lg"
              >
                <ChevronLeft size={16} strokeWidth={2.5} />
              </button>
              
              <div className="px-5 flex items-center gap-1.5">
                <span className="text-[14px] font-black font-mono text-white tracking-widest">{currentPage}</span>
                <span className="text-[14px] font-black text-white/10">/</span>
                <span className="text-[14px] font-black font-mono text-white/40 tracking-widest">{totalPages}</span>
              </div>

              <button 
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-2 text-white/30 hover:text-white disabled:opacity-5 disabled:cursor-not-allowed transition-all hover:bg-white/5 rounded-lg"
              >
                <ChevronRight size={16} strokeWidth={2.5} />
              </button>
              <button 
                onClick={() => goToPage(totalPages)}
                disabled={currentPage === totalPages}
                className="p-2 text-white/30 hover:text-white disabled:opacity-5 disabled:cursor-not-allowed transition-all hover:bg-white/5 rounded-lg"
              >
                <ChevronsRight size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* Mobile Pagination */}
          <div className="md:hidden flex items-center justify-center gap-4 py-4 bg-[#0a0a0a] border-t border-white/5">
              <button 
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-2 text-white/40 disabled:opacity-10"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-xs font-black text-white">{currentPage} / {totalPages}</span>
              <button 
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-2 text-white/40 disabled:opacity-10"
              >
                <ChevronRight size={20} />
              </button>
          </div>
        </div>
      );
    };
  }, [language, TopMoverCard]);

  useEffect(() => {
    const timer = setTimeout(() => {
      isInitializing.current = false;
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const [isPortrait, setIsPortrait] = useState(typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : true);
  const [shortData, setShortData] = useState<RowData[]>([]);
  const [longData, setLongData] = useState<RowData[]>([]);
  const [rankMap, setRankMap] = useState<Record<string, number>>({});
  
  // Shared state for MarketScreener, Header, and Sidebar
  const [previewCoin, setPreviewCoin] = useState<MarketCoin | null>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('smarteye_activeCoin');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.baseAsset === 'BTC' && (parsed.market === 'SPOT' || parsed.exchange === 'Bybit')) {
            return DEFAULT_COIN;
          }
          return parsed;
        } catch (e) { return DEFAULT_COIN; }
      }
    }
    return DEFAULT_COIN;
  });
  const [timeframe, setTimeframe] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('smarteye_timeframe') || '1m';
    }
    return '1m';
  });
  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('smarteye_favorites');
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [showExtraTf, setShowExtraTf] = useState(false);
  const [priceFlash, setPriceFlash] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const [spotSettings, setSpotSettings] = useState<SettingsState>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_PREFIX + 'spot') : null;
    const parsed = saved ? JSON.parse(saved) : {};
    return { ...DEFAULT_SETTINGS, ...parsed };
  });
  const [futuresSettings, setFuturesSettings] = useState<SettingsState>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_PREFIX + 'futures') : null;
    const parsed = saved ? JSON.parse(saved) : {};
    return { ...DEFAULT_SETTINGS, ...parsed };
  });

  const [chartLayout, setChartLayout] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('smarteye_chartLayout');
      return saved ? Number(saved) : 1;
    }
    return 1;
  });
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1000);
  const [alerts, setAlerts] = useState<{ id: string; symbol: string; price: number; type: 'above' | 'below' }[]>([]);
  const [comparisonCoins, setComparisonCoins] = useState<MarketCoin[]>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('smarteye_comparisonCoins');
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [magnetEnabled, setMagnetEnabled] = useState(false);
  const [isCoinSelectorOpen, setIsCoinSelectorOpen] = useState(false);
  const [selectorSlotIndex, setSelectorSlotIndex] = useState<number | null>(null);
  const [drawings, setDrawings] = useState<Record<string, any[]>>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('smarteye_drawings');
      const parsed = saved ? JSON.parse(saved) : {};
      
      // Migration: check if any keys are just symbols and update them if it's the current preview coin
      // However, it's safer to just start using the new key.
      return parsed;
    }
    return {};
  });
  const [activeExchanges, setActiveExchanges] = useState<Record<string, boolean>>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('smarteye_activeExchanges');
      return saved ? JSON.parse(saved) : { 'Binance': true, 'Bybit': true };
    }
    return { 'Binance': true, 'Bybit': true };
  });
  const [activeTypes, setActiveTypes] = useState<Record<string, boolean>>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('smarteye_activeTypes');
      return saved ? JSON.parse(saved) : { 'SPOT': true, 'FUTURES': true };
    }
    return { 'SPOT': true, 'FUTURES': true };
  });

  const [marketCoins, setMarketCoins] = useState<MarketCoin[]>([]);
  const fetchMarketCoinsRef = useRef(false);

  useEffect(() => {
    const fetchMarketData = async () => {
      if (fetchMarketCoinsRef.current) return;
      fetchMarketCoinsRef.current = true;
      try {
        const fetchDirectProxy = async (proxyUrl: string) => {
          const res = await fetch(proxyUrl);
          if (!res.ok) throw new Error(`Proxy status ${res.status}`);
          return await res.json();
        };

        const results = await Promise.allSettled([
          fetchDirectProxy('https://api.binance.com/api/v3/ticker/24hr'),
          fetchDirectProxy('https://fapi.binance.com/fapi/v1/ticker/24hr'),
          fetchDirectProxy('https://api.bybit.com/v5/market/tickers?category=spot'),
          fetchDirectProxy('https://api.bybit.com/v5/market/tickers?category=linear'),
        ]);

        const globEx = ['AGIX', 'ALPACA', 'ALPHA', 'LEVER', 'LINA', 'MEMEFI', 'PORT3', 'SXP', 'USD1', 'UXLINK', 'VID'];
        const isExcluded = (base: string) => globEx.includes(base.toUpperCase());

        let all: MarketCoin[] = [];
        
        if (results[0].status === 'fulfilled' && Array.isArray(results[0].value)) {
          results[0].value.forEach((t: any) => {
            if (t.symbol.endsWith('USDT')) {
              const base = t.symbol.replace('USDT', '');
              if (!isExcluded(base)) all.push({
                symbol: t.symbol, baseAsset: base, price: parseFloat(t.lastPrice),
                change24h: parseFloat(t.priceChangePercent), volume24h: parseFloat(t.quoteVolume),
                market: 'SPOT', exchange: 'Binance', logo: `/api/logos/${base.toUpperCase()}`
              });
            }
          });
        }
        if (results[1].status === 'fulfilled' && Array.isArray(results[1].value)) {
          results[1].value.forEach((t: any) => {
            if (t.symbol.endsWith('USDT')) {
              const base = t.symbol.replace('USDT', '');
              if (!isExcluded(base)) all.push({
                symbol: t.symbol, baseAsset: base, price: parseFloat(t.lastPrice),
                change24h: parseFloat(t.priceChangePercent), volume24h: parseFloat(t.quoteVolume),
                market: 'FUTURES', exchange: 'Binance', logo: `/api/logos/${base.toUpperCase()}`
              });
            }
          });
        }
        if (results[2].status === 'fulfilled' && results[2].value?.result?.list && Array.isArray(results[2].value.result.list)) {
          results[2].value.result.list.forEach((t: any) => {
            if (t.symbol.endsWith('USDT')) {
              const base = t.symbol.replace('USDT', '');
              if (!isExcluded(base)) all.push({
                symbol: t.symbol, baseAsset: base, price: parseFloat(t.lastPrice),
                change24h: parseFloat(t.price24hPcnt) * 100, volume24h: parseFloat(t.turnover24h),
                market: 'SPOT', exchange: 'Bybit', logo: `/api/logos/${base.toUpperCase()}`
              });
            }
          });
        }
        if (results[3].status === 'fulfilled' && results[3].value?.result?.list && Array.isArray(results[3].value.result.list)) {
          results[3].value.result.list.forEach((t: any) => {
            if (t.symbol.endsWith('USDT')) {
              const base = t.symbol.replace('USDT', '');
              if (!isExcluded(base)) all.push({
                symbol: t.symbol, baseAsset: base, price: parseFloat(t.lastPrice),
                change24h: parseFloat(t.price24hPcnt) * 100, volume24h: parseFloat(t.turnover24h),
                market: 'FUTURES', exchange: 'Bybit', logo: `/api/logos/${base.toUpperCase()}`
              });
            }
          });
        }

        if (all.length > 0) setMarketCoins(all);
      } catch (e) {
        console.error('Failed to fetch market data logic', e);
      } finally {
        fetchMarketCoinsRef.current = false;
      }
    };

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 5000);
    return () => clearInterval(interval);
  }, []);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    if (typeof localStorage !== 'undefined') {
      return (localStorage.getItem('smarteye_viewMode') as 'list' | 'grid') || 'list';
    }
    return 'list';
  });
  const [sortConfig, setSortConfig] = useState<{ key: string, dir: 'asc' | 'desc' }>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('smarteye_sortConfig');
      return saved ? JSON.parse(saved) : { key: 'none', dir: 'desc' };
    }
    return { key: 'none', dir: 'desc' };
  });
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);

  const [connectionStatus, setConnectionStatus] = useState<'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED'>('DISCONNECTED');

  const filteredLongData = useMemo(() => 
    longData.filter(d => {
      const isExcluded = isDensityExcluded(d.pair, d.exchange || '', d.marketType || 'SPOT');
      if (isExcluded) return false;
      
      // Apply UI-side filtering based on settings
      const settings = d.marketType === 'SPOT' ? spotSettings : futuresSettings;
      
      const currentVol = Number(d.rawVolume || 0);
      const minDensityVol = Number(settings.minDensityVolume) || 40000;
      if (currentVol < minDensityVol) return false;
      
      const distPct = Math.abs(Number(d.percentage) || 0);
      const maxDistPct = Number(settings.distancePercentage) || 2.0;
      if (distPct > maxDistPct) return false;

      const relDensity = Number(d.relDensity || 0);
      const minRelDensity = Number(settings.peerMultiplier) || 2.5;
      if (relDensity < minRelDensity) return false;
      
      return true;
    }),
  [longData, spotSettings, futuresSettings]);

  const filteredShortData = useMemo(() => 
    shortData.filter(d => {
      const isExcluded = isDensityExcluded(d.pair, d.exchange || '', d.marketType || 'SPOT');
      if (isExcluded) return false;
      
      // Apply UI-side filtering based on settings
      const settings = d.marketType === 'SPOT' ? spotSettings : futuresSettings;
      
      const currentVol = Number(d.rawVolume || 0);
      const minDensityVol = Number(settings.minDensityVolume) || 40000;
      if (currentVol < minDensityVol) return false;
      
      const distPct = Math.abs(Number(d.percentage) || 0);
      const maxDistPct = Number(settings.distancePercentage) || 2.0;
      if (distPct > maxDistPct) return false;

      const relDensity = Number(d.relDensity || 0);
      const minRelDensity = Number(settings.peerMultiplier) || 2.5;
      if (relDensity < minRelDensity) return false;
      
      return true;
    }),
  [shortData, spotSettings, futuresSettings]);

  const [selectedExchanges, setSelectedExchanges] = useState<ExchangeSelection>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('smarteye_selectedExchanges');
      return saved ? JSON.parse(saved) : { 
        'Binance Spot': true, 'Binance Futures': true, 'Bybit Spot': true, 'Bybit Futures': true
      };
    }
    return { 'Binance Spot': true, 'Binance Futures': true, 'Bybit Spot': true, 'Bybit Futures': true };
  });

  const [showSubscriptionPrompt, setShowSubscriptionPrompt] = useState(false);
  const [showTrialNotification, setShowTrialNotification] = useState(false);
  const [trialTimeLeft, setTrialTimeLeft] = useState<number | null>(null);
  const trialStartedRef = useRef(false);

  // Trial logic for registered users
  useEffect(() => {
    if (dbUser && (dbUser.subscription_tier === 'free' || !dbUser.subscription_tier)) {
      const now = Date.now();
      const createdAt = new Date(dbUser.created_at || now).getTime();
      const trialDuration = 2 * 24 * 60 * 60 * 1000; // 2 days
      const elapsed = now - createdAt;

      if (elapsed < trialDuration) {
        const remaining = Math.ceil((trialDuration - elapsed) / 1000);
        if (trialTimeLeft === null) setTrialTimeLeft(remaining);
        
        // Show trial notification only once after registration
        const justRegistered = localStorage.getItem('se_just_registered') === 'true';
        if (!trialStartedRef.current && justRegistered) {
          setShowTrialNotification(true);
          setTimeout(() => setShowTrialNotification(false), 8000);
          showToast?.(language === 'ru' ? 'Вам предоставлен пробный период 2 дня' : 'You have been granted a 2-day trial period', 'info');
          localStorage.removeItem('se_just_registered');
        }
        trialStartedRef.current = true;
      } else {
        setTrialTimeLeft(0);
        trialStartedRef.current = true;
      }
    } else {
      setTrialTimeLeft(null);
      trialStartedRef.current = false;
    }
  }, [dbUser, language, showToast, trialTimeLeft]);

  useEffect(() => {
    if (trialTimeLeft !== null && trialTimeLeft > 0 && dbUser) {
      const timer = setInterval(() => {
        setTrialTimeLeft(prev => {
          if (prev !== null && prev <= 1) {
            clearInterval(timer);
            showToast?.(language === 'ru' ? 'Пробный период окончен. Оформите подписку для продолжения.' : 'Trial period ended. Please subscribe to continue.', 'info');
            return 0;
          }
          return prev !== null ? prev - 1 : 0;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [dbUser]); // Interval only depends on user existence, doesn't restart every second

  const isRestricted = useMemo(() => {
    if (!dbUser) return false;
    // If user has a trial period active, they are not restricted
    if (trialTimeLeft !== null && trialTimeLeft > 0) return false;
    return dbUser.subscription_tier === 'free' || !dbUser.subscription_tier;
  }, [dbUser, trialTimeLeft]);

  const lastSavedSettingsRef = useRef<string>('');

  const checkAuth = useCallback(() => {
    if (!dbUser) {
      onAuthRequired?.();
      return false;
    }
    return true;
  }, [dbUser, onAuthRequired]);

  const checkSubscription = (featureName: string) => {
    if (!checkAuth()) return false;
    
    // If user has a subscription (pro or whale), allow everything
    if (dbUser && dbUser.subscription_tier && dbUser.subscription_tier !== 'free') {
      return true;
    }

    // Allow usage during trial period for registered users
    if (trialTimeLeft !== null && trialTimeLeft > 0) {
      return true;
    }

    // Restricted features for free users
    const restrictedFeatures = [
      'Densities', 
      'API Analysis', 
      'AI Analysis',
      'Charts', 
      'Multi-Charts', 
      'Notifications', 
      'Simulator',
      'News',
      'FnG'
    ];
    
    if (restrictedFeatures.includes(featureName)) {
      setShowSubscriptionPrompt(true);
      return false;
    }

    return true;
  };

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastDensityIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Preload notification sound
    audioRef.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    return () => {
      audioRef.current = null;
    };
  }, []);

  const playAlert = useCallback((volume: number = 0.5) => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.log('Audio play failed:', e));
    }
  }, []);

  useEffect(() => {
    if (isInitializing.current) return;

    const allDensities = [...filteredLongData, ...filteredShortData];
    let shouldPlay = false;
    let playVolume = 0.5;

    for (const d of allDensities) {
      if (!lastDensityIds.current.has(d.id)) {
        // New density detected
        const marketType = d.marketType as MarketType;
        const settings = marketType === 'SPOT' ? spotSettings : futuresSettings;
        if (settings.soundAlertEnabled) {
          shouldPlay = true;
          playVolume = settings.soundAlertVolume ?? 0.5;
          break;
        }
      }
    }

    // Update tracked IDs
    lastDensityIds.current = new Set(allDensities.map(d => d.id));

    if (shouldPlay) {
      playAlert(playVolume);
    }
  }, [longData, shortData, spotSettings, futuresSettings, playAlert]);

  // Load DB data
  useEffect(() => {
    const init = async () => {
      setIsSettingsLoaded(false);
      try {
        if (dbUser) {
          loadAlerts();
          await loadSettings();
          simulatorService.setUserId(dbUser.id, dbUser.balance);
        } else {
          // When not logged in, we already loaded from localStorage via initializers
          simulatorService.setUserId(null);
        }
      } catch (e) {
        console.error('Init error:', e);
      } finally {
        setIsSettingsLoaded(true);
      }
    };
    init();
  }, [dbUser]);

  const loadAlerts = async () => {
    if (!dbUser) return;
    try {
      const dbAlerts = await apiService.getAlerts(dbUser.id);
      setAlerts(dbAlerts.map(a => ({
        id: a.id,
        symbol: a.symbol,
        price: Number(a.price),
        type: a.type
      })));
    } catch (error) {
      console.error('Failed to load alerts:', error);
    }
  };

  const loadSettings = async () => {
    if (!dbUser) return;
    try {
      const settings = await apiService.getSettings(dbUser.id) as any;
      if (settings) {
        if (settings.spotSettings) setSpotSettings({ ...DEFAULT_SETTINGS, ...settings.spotSettings });
        if (settings.futuresSettings) setFuturesSettings({ ...DEFAULT_SETTINGS, ...settings.futuresSettings });
        
        if (settings.activeCoin) {
          // Force BTC to Futures Binance if it's currently Spot or Bybit during initialization
          let coinToSet = settings.activeCoin;
          if (coinToSet.baseAsset === 'BTC' && (coinToSet.market === 'SPOT' || coinToSet.exchange === 'Bybit')) {
            coinToSet = DEFAULT_COIN;
          }
          setPreviewCoin(coinToSet);
        } else {
          // If no active coin in DB (new user), set to BTC Futures
          setPreviewCoin(DEFAULT_COIN);
          localStorage.setItem('smarteye_activeCoin', JSON.stringify(DEFAULT_COIN));
        }

        if (settings.timeframe) setTimeframe(settings.timeframe);
        if (settings.favorites) setFavorites(settings.favorites);
        if (settings.drawings) setDrawings(settings.drawings);
        if (settings.activeExchanges) setActiveExchanges(settings.activeExchanges);
        if (settings.activeTypes) setActiveTypes(settings.activeTypes);
        if (settings.viewMode) setViewMode(settings.viewMode as 'list' | 'grid');
        if (settings.sortConfig) setSortConfig(settings.sortConfig as any);
        if (settings.comparisonCoins) setComparisonCoins(settings.comparisonCoins);
        if (settings.chartLayout) setChartLayout(settings.chartLayout);
        if (settings.selectedExchanges) setSelectedExchanges(settings.selectedExchanges);

        // Update ref to prevent immediate re-save of loaded data
        lastSavedSettingsRef.current = JSON.stringify({
          favorites: settings.favorites || favorites,
          activeCoin: settings.activeCoin || previewCoin,
          timeframe: settings.timeframe || timeframe,
          drawings: settings.drawings || drawings,
          activeExchanges: settings.activeExchanges || activeExchanges,
          activeTypes: settings.activeTypes || activeTypes,
          viewMode: settings.viewMode || viewMode,
          sortConfig: settings.sortConfig || sortConfig,
          spotSettings: settings.spotSettings ? { ...DEFAULT_SETTINGS, ...settings.spotSettings } : spotSettings,
          futuresSettings: settings.futuresSettings ? { ...DEFAULT_SETTINGS, ...settings.futuresSettings } : futuresSettings
        });
      } else {
        // No settings at all (fresh registration)
        setPreviewCoin(DEFAULT_COIN);
        localStorage.setItem('smarteye_activeCoin', JSON.stringify(DEFAULT_COIN));
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  // Helper to save settings with debounce
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const saveCurrentSettings = async (updates: Partial<SettingsState>) => {
    if (!isSettingsLoaded) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      // Use current component state as the source of truth for ALL settings.
      const fullSettings: SettingsState = {
        ...DEFAULT_SETTINGS,
        favorites,
        activeCoin: previewCoin,
        timeframe,
        drawings,
        activeExchanges,
        activeTypes,
        viewMode,
        sortConfig,
        spotSettings,
        futuresSettings,
        comparisonCoins,
        chartLayout,
        selectedExchanges,
        ...updates // Overlay the specific updates
      };

      const settingsString = JSON.stringify(fullSettings);
      if (settingsString === lastSavedSettingsRef.current) return;
      lastSavedSettingsRef.current = settingsString;

      if (dbUser) {
        try {
          await apiService.saveSettings(dbUser.id, fullSettings);
        } catch (error) {
          console.error('Failed to save settings:', error);
        }
      } else {
        localStorage.setItem(STORAGE_PREFIX + 'settings', settingsString);
      }
    }, 1000);
  };

  // Auto-save favorites
  useEffect(() => {
    if (!isSettingsLoaded) return;
    if (dbUser) {
      saveCurrentSettings({ favorites });
    }
    localStorage.setItem('smarteye_favorites', JSON.stringify(favorites));
  }, [favorites, dbUser, isSettingsLoaded]);

  // Auto-save active coin and timeframe
  useEffect(() => {
    if (!isSettingsLoaded) return;
    if (previewCoin) {
      localStorage.setItem('smarteye_activeCoin', JSON.stringify(previewCoin));
      localStorage.setItem('smarteye_timeframe', timeframe);
      
      if (dbUser) {
        saveCurrentSettings({ activeCoin: previewCoin, timeframe });
      }
    }
  }, [previewCoin, timeframe, dbUser, isSettingsLoaded]);

  // Auto-save filters
  useEffect(() => {
    if (!isSettingsLoaded) return;
    if (dbUser) {
      saveCurrentSettings({ 
        activeExchanges, 
        activeTypes, 
        viewMode, 
        sortConfig,
        comparisonCoins,
        chartLayout,
        selectedExchanges
      });
    } else {
      localStorage.setItem('smarteye_activeExchanges', JSON.stringify(activeExchanges));
      localStorage.setItem('smarteye_activeTypes', JSON.stringify(activeTypes));
      localStorage.setItem('smarteye_viewMode', viewMode);
      localStorage.setItem('smarteye_sortConfig', JSON.stringify(sortConfig));
      localStorage.setItem('smarteye_comparisonCoins', JSON.stringify(comparisonCoins));
      localStorage.setItem('smarteye_chartLayout', chartLayout.toString());
      localStorage.setItem('smarteye_selectedExchanges', JSON.stringify(selectedExchanges));
    }
  }, [activeExchanges, activeTypes, viewMode, sortConfig, comparisonCoins, chartLayout, selectedExchanges, dbUser, isSettingsLoaded]);

  const onDrawingsChange = (key: string, symbolDrawings: any[]) => {
    setDrawings(prev => {
      const next = { ...prev, [key]: symbolDrawings };
      if (dbUser) {
        saveCurrentSettings({ drawings: next });
      } else {
        localStorage.setItem('smarteye_drawings', JSON.stringify(next));
      }
      return next;
    });
  };

  const onAddAlert = async (alert: { symbol: string; price: number; type: 'above' | 'below' }) => {
    if (!dbUser) {
      const newAlert = { ...alert, id: Math.random().toString(36).substr(2, 9) };
      setAlerts(prev => [newAlert, ...prev]);
      return;
    }

    try {
      const created = await apiService.createAlert({
        user_id: dbUser.id,
        symbol: alert.symbol,
        price: alert.price,
        type: alert.type
      });
      setAlerts(prev => [{
        id: created.id,
        symbol: created.symbol,
        price: Number(created.price),
        type: created.type
      }, ...prev]);
    } catch (error) {
      console.error('Failed to save alert:', error);
    }
  };

  const onRemoveAlert = async (id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
    if (dbUser) {
      try {
        await apiService.deleteAlert(id);
      } catch (error) {
        console.error('Failed to delete alert:', error);
      }
    }
  };
  
  // Handle Escape key to exit fullscreen
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isFullscreen]);
  
  const miniChartRef = useRef<any>(null);
  const tfDropdownRef = useRef<HTMLDivElement>(null);

  const onUndo = () => miniChartRef.current?.undo?.();
  const onRedo = () => miniChartRef.current?.redo?.();
  const onClearAll = () => miniChartRef.current?.clearAll?.();
  const onToggleMagnet = () => setMagnetEnabled(prev => !prev);

  const MAIN_TIMEFRAMES = ['1m', '15m', '1h'];
  const EXTRA_TIMEFRAMES = [
    { label: language === 'ru' ? 'Минуты' : 'Minutes', items: ['1m', '3m', '5m', '15m', '30m'] },
    { label: language === 'ru' ? 'Часы' : 'Hours', items: ['1h', '2h', '4h', '6h', '12h'] },
    { label: language === 'ru' ? 'Дни/Недели' : 'Days/Weeks', items: ['1d', '1w'] }
  ];

  useEffect(() => {
    if (previewCoin) {
      setPriceFlash(true);
      const timer = setTimeout(() => setPriceFlash(false), 300);
      return () => clearTimeout(timer);
    }
  }, [previewCoin?.price]);

  const toggleFavorite = (e: React.MouseEvent, coin: MarketCoin) => {
    e.stopPropagation();
    if (!checkAuth()) return;
    const key = `${coin.exchange}:${coin.market}:${coin.symbol}`;
    setFavorites(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const isFavorite = (coin: MarketCoin) => {
    return favorites.includes(`${coin.exchange}:${coin.market}:${coin.symbol}`);
  };
  
  const [isExchangeDropdownOpen, setIsExchangeDropdownOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [aiBookCoin, setAiBookCoin] = useState<any>(null);
  const [isAiBookOpen, setIsAiBookOpen] = useState(false);
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const [isNavVisible, setIsNavVisible] = useState(true);
  const navTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const exchangeDropdownRef = useRef<HTMLDivElement>(null);

  const resetNavTimeout = useCallback(() => {
    if (!isPortrait) {
      setIsNavVisible(true);
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
      navTimeoutRef.current = setTimeout(() => {
        setIsNavVisible(false);
      }, 3000); // 3 seconds of idle to hide
    } else {
      setIsNavVisible(true);
    }
  }, [isPortrait]);

  useEffect(() => {
    if (!isPortrait) {
      resetNavTimeout();
    } else {
      setIsNavVisible(true);
    }
  }, [isPortrait, resetNavTimeout]);

  // Scroll to top on tab change
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const screenerListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === 'screener' && screenerListRef.current) {
      screenerListRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  useEffect(() => {
    const handleActivity = () => resetNavTimeout();
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('scroll', handleActivity);
    
    return () => {
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('scroll', handleActivity);
    };
  }, [resetNavTimeout]);

  const spotSettingsRef = useRef(spotSettings);
  const futuresSettingsRef = useRef(futuresSettings);

  useEffect(() => {
    spotSettingsRef.current = spotSettings;
    if (isSettingsLoaded && dbUser) {
      saveCurrentSettings({ spotSettings: spotSettings as any });
    } else {
      localStorage.setItem(STORAGE_PREFIX + 'spot', JSON.stringify(spotSettings));
    }
  }, [spotSettings, dbUser, isSettingsLoaded]);

  useEffect(() => {
    futuresSettingsRef.current = futuresSettings;
    if (isSettingsLoaded && dbUser) {
      saveCurrentSettings({ futuresSettings: futuresSettings as any });
    } else {
      localStorage.setItem(STORAGE_PREFIX + 'futures', JSON.stringify(futuresSettings));
    }
  }, [futuresSettings, dbUser, isSettingsLoaded]);

  useEffect(() => {
    const fetchRanks = async () => {
      try {
        const mapping = await apiService.getRanks();
        if (mapping && Object.keys(mapping).length > 0) {
          setRankMap(mapping);
          engine.setRankMap(mapping);
        }
      } catch (error) {
        console.error('Error fetching ranks from backend:', error);
      }
    };
    fetchRanks();
    // Refresh ranks every hour
    const interval = setInterval(fetchRanks, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [engine]);

  useEffect(() => {
    const subL = engine.longs$.subscribe(setLongData);
    const subS = engine.shorts$.subscribe(setShortData);
    const subStatus = engine.connectionStatus$.subscribe(setConnectionStatus);
    engine.startPipeline(CONFIG.engineTickMs, (t) => t === 'SPOT' ? spotSettingsRef.current : futuresSettingsRef.current);
    
    const handleClickOutside = (event: MouseEvent) => {
      if (exchangeDropdownRef.current && !exchangeDropdownRef.current.contains(event.target as Node)) {
        setIsExchangeDropdownOpen(false);
      }
      if (tfDropdownRef.current && !tfDropdownRef.current.contains(event.target as Node)) {
        setShowExtraTf(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    const handleResize = () => {
      setIsPortrait(window.innerHeight > window.innerWidth);
    };
    window.addEventListener('resize', handleResize);

    return () => { 
      subL.unsubscribe(); subS.unsubscribe(); subStatus.unsubscribe();
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleResize);
    };
  }, [engine]);

  useEffect(() => {
    const configs: ExchangeConfig[] = [];
    if (selectedExchanges['Binance Spot']) configs.push(...getConfigsForMarket('SPOT', 'Binance'));
    if (selectedExchanges['Binance Futures']) configs.push(...getConfigsForMarket('FUTURES', 'Binance'));
    if (selectedExchanges['Bybit Spot']) configs.push(...getConfigsForMarket('SPOT', 'Bybit'));
    if (selectedExchanges['Bybit Futures']) configs.push(...getConfigsForMarket('FUTURES', 'Bybit'));
    engine.connectExchanges(configs);
  }, [selectedExchanges, engine]);

  const toggleExchange = (key: string) => setSelectedExchanges(prev => ({...prev, [key]: !prev[key]}));

  const handleInputChange = (type: MarketType, key: keyof SettingsState | 'test', val: any) => {
    if (key === 'test') {
      const settings = type === 'SPOT' ? spotSettings : futuresSettings;
      playAlert(settings.soundAlertVolume ?? 0.5);
      return;
    }
    const settingsKey = key as keyof SettingsState;
    if (type === 'SPOT') setSpotSettings(p => ({...p, [settingsKey]: val}));
    else setFuturesSettings(p => ({...p, [settingsKey]: val}));
  };

  const resetToDefault = (type: MarketType) => {
    if (type === 'SPOT') setSpotSettings({ ...DEFAULT_SETTINGS });
    else setFuturesSettings({ ...DEFAULT_SETTINGS });
  };

  const exchangeList = [
    { key: 'Binance Spot', name: 'Binance', sub: 'СПОТ', logo: BINANCE_ICON },
    { key: 'Binance Futures', name: 'Binance', sub: 'ФЬЮЧЕРС', logo: BINANCE_ICON },
    { key: 'Bybit Spot', name: 'Bybit', sub: 'СПОТ', logo: BYBIT_ICON },
    { key: 'Bybit Futures', name: 'Bybit', sub: 'ФЬЮЧЕРС', logo: BYBIT_ICON },
  ];

  const handleSetPreviewCoin = useCallback((action: React.SetStateAction<MarketCoin | null>) => {
    if (typeof action === 'function') {
      setPreviewCoin(action);
    } else if (action) {
      const isSameCoin = previewCoin && 
        action.symbol === previewCoin.symbol && 
        action.exchange === previewCoin.exchange && 
        action.market === previewCoin.market;
      
      const isInitialLoad = !previewCoin;
      
      // Allow switching coins for preview/browsing even without auth
      // Feature-level restrictions are handled separately
      if (isInitializing.current || isSameCoin || isInitialLoad || dbUser || true) {
        setPreviewCoin(action);
        
        // Scroll to top when changing coin from the dashboard (e.g., from Densities table)
        if (!isInitialLoad && !isSameCoin) {
          setTimeout(() => {
            const header = document.getElementById('app-header');
            if (header) {
              header.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }, 50);
        }
      }
    } else {
      setPreviewCoin(null);
    }
  }, [previewCoin, dbUser]);

  return (
    <div className="h-full w-full bg-black text-white p-0 flex flex-col overflow-hidden relative">
      <div id="app-header" className={`sticky top-0 z-[100000] flex flex-col shrink-0 border-b border-white/10 ${isAiBookOpen || isAuthModalOpen ? 'hidden' : ''}`}>
        {/* TOP ROW: LOGO + MAIN NAV + TOOLS */}
        <div className="flex justify-between items-center h-11 md:h-14 bg-black pl-1 pr-1 md:px-2 border-b border-white/5">
          <div className="flex items-center gap-1 md:gap-1">
            <div className="flex items-center gap-1 md:gap-1.5 group cursor-default">
              <div className="hidden md:block">
                <Logo size="md" textBreakpoint="xl" />
              </div>
              <div className="md:hidden">
                <Logo size="sm" />
              </div>
              {connectionStatus !== 'CONNECTED' && (
                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-tighter transition-all ${
                  connectionStatus === 'RECONNECTING' 
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-500 animate-pulse' 
                  : 'bg-red-500/10 border-red-500/30 text-red-500'
                }`}>
                  <div className={`w-1 h-1 rounded-full ${connectionStatus === 'RECONNECTING' ? 'bg-amber-500' : 'bg-red-500'}`} />
                  {connectionStatus === 'RECONNECTING' ? (language === 'ru' ? 'Переподключение...' : 'Reconnecting...') : (language === 'ru' ? 'Отключено' : 'Disconnected')}
                </div>
              )}
            </div>
          </div>
          
          <div className="hidden md:flex flex-1 justify-start ml-2 lg:ml-4 xl:ml-8">
            <div className="flex items-center bg-white/[0.02] p-1 rounded-xl">
                <button 
                  onClick={() => {
                    if (checkSubscription('Charts')) {
                      setActiveTab('market');
                    }
                  }} 
                  className={`flex items-center gap-2 px-3 xl:px-6 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
                    activeTab === 'market' 
                    ? 'bg-white/5 text-white shadow-[0_0_15px_rgba(255,255,255,0.03)]' 
                    : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  <TrendingUp size={14} /> <span>{t.market}</span>
                </button>
                <div className="w-[1px] h-4 bg-white/10 mx-2" />
                <button 
                  onClick={() => {
                    if (checkSubscription('Densities')) {
                      setActiveTab('screener');
                    }
                  }} 
                  className={`flex items-center gap-2 px-3 xl:px-6 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
                    activeTab === 'screener' 
                    ? 'bg-white/5 text-white shadow-[0_0_15px_rgba(255,255,255,0.03)]' 
                    : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  <LayoutGrid size={14} /> <span>{t.densities}</span>
                </button>
                <div className="w-[1px] h-4 bg-white/10 mx-2" />
                <button 
                  onClick={() => {
                    setActiveTab('top_movers');
                  }} 
                  className={`flex items-center gap-2 px-3 xl:px-6 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
                    activeTab === 'top_movers' 
                    ? 'bg-white/5 text-white shadow-[0_0_15px_rgba(255,255,255,0.03)]' 
                    : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  <BarChart2 size={14} /> <span>{t.top_movers}</span>
                </button>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <LanguageSwitcher language={language} setLanguage={setLanguage} />

            <div className="w-[1px] h-5 bg-white/10 mx-1 hidden md:block" />

            {/* TIMEFRAME SELECTOR - ONLY SHOW WHEN MULTIPLE CHARTS ARE ACTIVE */}
            {(chartLayout > 1 || comparisonCoins.length > 0) && (
              <div className="flex items-center bg-white/[0.02] p-0.5 md:p-1 rounded-xl shadow-xl">
                <div className="hidden sm:flex items-center">
                  {MAIN_TIMEFRAMES.map((tf) => (
                    <button 
                      key={tf}
                      onClick={() => setTimeframe(tf)} 
                      className={`px-1.5 md:px-2 lg:px-2 py-1 md:py-1.5 rounded-lg text-[9px] md:text-[11px] lg:text-[11px] font-black font-mono uppercase transition-all ${
                        timeframe === tf 
                        ? 'bg-white/10 text-white shadow-[0_0_15px_rgba(255,255,255,0.05)]' 
                        : 'text-white/40 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                  <div className="w-[1px] h-3 md:h-4 bg-white/10 mx-1 md:mx-1.5"></div>
                </div>
                <div className="relative" ref={tfDropdownRef}>
                  <button 
                    onClick={() => setShowExtraTf(!showExtraTf)}
                    className={`w-6 h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 rounded-lg flex items-center justify-center transition-all ${
                      EXTRA_TIMEFRAMES.some(s => s.items.includes(timeframe)) && !MAIN_TIMEFRAMES.includes(timeframe)
                      ? 'text-purple-400 bg-purple-500/15 border border-purple-500/30' 
                      : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-1 px-1">
                      <span className="sm:hidden text-[10px] font-black font-mono text-white/70">{timeframe}</span>
                      <ChevronDown size={14} className={`transition-transform duration-300 ${showExtraTf ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  
                  {showExtraTf && (
                    <div className="absolute top-full right-0 mt-3 bg-[#0d0d0d] border border-white/10 rounded-2xl shadow-[0_25px_70px_rgba(0,0,0,0.9)] z-[3002] min-w-[220px] animate-in fade-in slide-in-from-top-3 duration-300 overflow-hidden ring-1 ring-white/5">
                      <div className="max-h-[70vh] overflow-y-auto no-scrollbar py-2">
                        {EXTRA_TIMEFRAMES.map((section, sIdx) => (
                          <div key={section.label} className={sIdx > 0 ? 'border-t border-white/5 mt-2 pt-2' : ''}>
                            <div className="px-4 py-1.5 flex items-center justify-between group cursor-default">
                              <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest">{section.label}</span>
                              <ChevronUp size={10} className="text-gray-700" />
                            </div>
                            
                            <div className="flex flex-col px-2 gap-1">
                              {section.items.map(tf => {
                                const isActive = timeframe === tf;
                                return (
                                  <button 
                                    key={tf} 
                                    onClick={() => {
                                      setTimeframe(tf);
                                      setShowExtraTf(false);
                                    }} 
                                    className={`w-full px-4 py-2.5 flex items-center justify-between transition-all group relative rounded-xl border ${
                                      isActive 
                                      ? 'bg-white/5 border-white/20 text-white' 
                                      : 'bg-transparent border-transparent text-white/40 hover:text-white hover:bg-white/5'
                                    }`}
                                  >
                                    <span className={`text-[12px] font-bold font-mono uppercase ${isActive ? 'translate-x-1' : ''} transition-transform`}>
                                      {tf}
                                    </span>
                                    {isActive && <Check size={14} className="text-white" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="w-[1px] h-5 bg-white/10 mx-1 hidden md:block" />

            <button 
              onClick={() => onNavigateToProfile()} 
              className="hidden md:flex items-center gap-1.5 lg:gap-2.5 pl-1.5 lg:pl-3 pr-1 py-1 bg-white/[0.02] rounded-full hover:bg-white/10 transition-all group"
            >
              <div className="hidden lg:flex flex-col items-end leading-none">
                <span className="text-[10px] font-black text-white uppercase tracking-wider">{t.profile}</span>
              </div>
              <div className="p-0.5 bg-purple-500/10 border border-purple-500/20 rounded-full group-hover:bg-purple-500/20 transition-all">
                <SubscriptionAvatar 
                  tier={avatarTier} 
                  size={28} 
                  imageClassName="translate-y-[-2%] sm:translate-y-[5%] lg:translate-y-[42%] landscape:translate-y-[12%]"
                />
              </div>
            </button>
          </div>
        </div>

        {/* BOTTOM ROW: TERMINAL CONTROLS (UNIFIED) */}
      </div>
      
      <div className={`flex-1 min-h-0 overflow-hidden bg-[#050505] relative pb-16 md:pb-0 flex flex-row ${isAiBookOpen ? 'hidden md:flex' : ''}`}>
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <div className={`flex-1 flex-col overflow-hidden transition-all duration-500 relative ${activeTab === 'market' ? 'flex' : 'hidden'} ${
            isFullscreen ? 'fixed z-[50000] top-11 md:top-14 left-0 right-0 bottom-0 bg-black' : ''
          }`}>
            <ChartBlock 
              previewCoin={previewCoin}
              language={language}
              t={t}
              isPortrait={isPortrait}
              isReplayMode={isReplayMode}
              setIsReplayMode={setIsReplayMode}
              setIsAiBookOpen={setIsAiBookOpen}
              setAiBookCoin={setAiBookCoin}
              timeframe={timeframe}
              setTimeframe={setTimeframe}
              historyState={historyState}
              miniChartRef={miniChartRef}
              showExtraTf={showExtraTf}
              setShowExtraTf={setShowExtraTf}
              tfDropdownRef={tfDropdownRef}
              isFavorite={isFavorite}
              toggleFavorite={toggleFavorite}
              isFullscreen={isFullscreen}
              chartLayout={chartLayout}
              comparisonCoins={comparisonCoins}
              checkSubscription={checkSubscription}
            />
            <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-500 bg-[#0a0a0a] relative ${
              isFullscreen ? 'h-full w-full rounded-none border-none' : ''
            }`}>
              {/* MARKET SCREENER - HANDLES CHART, CONTROLS AND ITS OWN SCROLLABLE LIST */}
              <MemoMarketScreener 
                language={language} 
                previewCoin={previewCoin}
                setPreviewCoin={handleSetPreviewCoin}
                timeframe={timeframe}
                setTimeframe={setTimeframe}
                miniChartRef={miniChartRef}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                rankMap={rankMap}
                onHistoryChange={setHistoryState}
                onOpenAI={(coin) => {
                  if (checkSubscription('API Analysis')) {
                    setAiBookCoin(coin);
                    setIsAiBookOpen(true);
                  }
                }}
                isAiModalOpen={isAiBookOpen}
                chartLayout={chartLayout}
                setChartLayout={setChartLayout}
                isReplayMode={isReplayMode}
                setIsReplayMode={setIsReplayMode}
                isPlaying={isPlaying}
                setIsPlaying={setIsPlaying}
                replaySpeed={replaySpeed}
                setReplaySpeed={setReplaySpeed}
                comparisonCoins={comparisonCoins}
                setComparisonCoins={setComparisonCoins}
                alerts={alerts}
                setAlerts={setAlerts}
                engine={engine}
                isFullscreen={isFullscreen}
                setIsFullscreen={setIsFullscreen}
                isSettingsLoaded={isSettingsLoaded}
                activeTool={activeTool}
                onToolChange={setActiveTool}
                magnetEnabled={magnetEnabled}
                onMagnetChange={onToggleMagnet}
                isCoinSelectorOpen={isCoinSelectorOpen}
                setIsCoinSelectorOpen={setIsCoinSelectorOpen}
                selectorSlotIndex={selectorSlotIndex}
                setSelectorSlotIndex={setSelectorSlotIndex}
                drawings={drawings}
                onDrawingsChange={onDrawingsChange}
                activeExchanges={activeExchanges}
                setActiveExchanges={setActiveExchanges}
                activeTypes={activeTypes}
                setActiveTypes={setActiveTypes}
                viewMode={viewMode}
                setViewMode={setViewMode}
                sortConfig={sortConfig}
                setSortConfig={setSortConfig}
                checkSubscription={checkSubscription}
              />
            </div>
          </div>

          <div className={`flex-1 overflow-hidden transition-all duration-500 relative ${activeTab === 'screener' ? 'flex flex-col' : 'hidden'}`}>
            <div 
              ref={screenerListRef}
              onScroll={resetNavTimeout}
              className="flex-1 overflow-y-auto bg-[#0a0a0a] relative custom-scroll scroll-smooth flex flex-col"
            >
              <MemoTable 
                shortData={filteredShortData} 
                longData={filteredLongData} 
                language={language} 
                onOpenAI={(coin) => {
                  if (checkSubscription('API Analysis')) {
                    setAiBookCoin(coin);
                    setIsAiBookOpen(true);
                  }
                }}
                spotSettings={spotSettings}
                futuresSettings={futuresSettings}
                onSettingChange={handleInputChange}
                onResetSettings={resetToDefault}
                isBlurred={isRestricted}
                activeExchanges={selectedExchanges}
                onToggleExchange={toggleExchange}
              />
            </div>
          </div>

          <div className={`flex-1 overflow-hidden transition-all duration-500 relative ${activeTab === 'top_movers' ? 'flex flex-col' : 'hidden'}`}>
            <div 
              className="flex-1 overflow-hidden bg-[#0a0a0a] relative flex flex-col"
            >
              <TopMoversView data={marketCoins} onSelectCoin={(coin) => {
                setActiveTab('market');
                handleSetPreviewCoin(coin);
              }} />
            </div>
          </div>
        </div>

        <div className={activeTab === 'market' ? 'flex' : 'hidden'}>
          <MarketSidebar 
            language={language} 
            chartLayout={chartLayout}
            setChartLayout={setChartLayout}
            alerts={alerts}
            onAddAlert={onAddAlert}
            onRemoveAlert={onRemoveAlert}
            activeCoin={previewCoin}
            isOpen={isSidebarOpen}
            setIsOpen={setIsSidebarOpen}
            onSelectCoin={(coin) => {
              setComparisonCoins(prev => {
                const exists = prev.some(c => c.symbol === coin.symbol && c.exchange === coin.exchange && c.market === coin.market);
                if (exists) return prev;
                const newList = [...prev, coin].slice(0, 3);
                setChartLayout(newList.length + 1);
                return newList;
              });
            }}
            comparisonCoins={comparisonCoins}
            replayState={{ isReplayMode, isPlaying, replaySpeed }}
            onToggleReplayMode={() => {
              if (checkSubscription('Simulator')) setIsReplayMode(!isReplayMode);
            }}
            onTogglePlayPause={() => {
              if (checkSubscription('Simulator')) setIsPlaying(!isPlaying);
            }}
            onSetReplaySpeed={setReplaySpeed}
            activeTool={activeTool}
            onToolChange={setActiveTool}
            onUndo={onUndo}
            onRedo={onRedo}
            onClearAll={onClearAll}
            magnetEnabled={magnetEnabled}
            onToggleMagnet={onToggleMagnet}
            canUndo={historyState.canUndo}
            canRedo={historyState.canRedo}
            onOpenCoinSelector={() => {
              setSelectorSlotIndex(-1);
              setIsCoinSelectorOpen(true);
            }}
            checkSubscription={checkSubscription}
          />
        </div>
      </div>

      {isAiBookOpen && aiBookCoin && (
        <AIBookModal 
          coin={aiBookCoin} 
          language={language}
          onClose={() => {
            setIsAiBookOpen(false);
            setAiBookCoin(null);
          }} 
        />
      )}

      {/* Mobile Bottom Navigation Fade Gradient */}
      {!isFullscreen && !isAiBookOpen && (
        <div className={`md:hidden fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none z-[19999] transition-all duration-500 ${isNavVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full'}`} />
      )}

      {/* Mobile Bottom Navigation */}
      {!isFullscreen && !isAiBookOpen && (
        <div className={`md:hidden fixed bottom-1.5 left-1.5 right-1.5 h-12 bg-[#050505]/90 rounded-2xl backdrop-blur-xl flex items-center justify-around px-4 z-[20000] pb-safe transition-all duration-500 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] ${isNavVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full'}`}>
          <button 
            onClick={() => {
              if (checkSubscription('Charts')) {
                setActiveTab('market');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            className={`flex flex-col items-center justify-center gap-0.5 w-16 transition-all ${
              activeTab === 'market' ? 'text-white' : 'text-gray-500'
            }`}
          >
            <TrendingUp size={18} className={activeTab === 'market' ? 'scale-110 text-white' : ''} />
            <span className="text-[8px] font-bold uppercase tracking-tighter">{t.market}</span>
          </button>

          <div className="w-[1px] h-4 bg-white/10" />

          <button 
            onClick={() => {
              if (checkSubscription('Densities')) {
                setActiveTab('screener');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            className={`flex flex-col items-center justify-center gap-0.5 w-16 transition-all ${
              activeTab === 'screener' ? 'text-white' : 'text-gray-500'
            }`}
          >
            <LayoutGrid size={18} className={activeTab === 'screener' ? 'scale-110 text-white' : ''} />
            <span className="text-[8px] font-bold uppercase tracking-tighter">{t.densities}</span>
          </button>

          <div className="w-[1px] h-4 bg-white/10" />

          <button 
            onClick={() => {
              setActiveTab('top_movers');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`flex flex-col items-center justify-center gap-0.5 w-16 transition-all ${
              activeTab === 'top_movers' ? 'text-white' : 'text-gray-500'
            }`}
          >
            <BarChart2 size={18} className={activeTab === 'top_movers' ? 'scale-110 text-white' : ''} />
            <span className="text-[8px] font-bold uppercase tracking-tighter">{t.top_movers}</span>
          </button>

          <div className="w-[1px] h-4 bg-white/10" />

          <button 
            className="flex flex-col items-center justify-center gap-0.5 w-16 text-gray-500 hover:text-white transition-colors"
            onClick={() => {
              onNavigateToProfile();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <div className="w-6 h-6 rounded-full overflow-hidden border border-white/10">
              <SubscriptionAvatar 
                tier={avatarTier} 
                size={24} 
                imageClassName="translate-y-[-2%] sm:translate-y-[5%] lg:translate-y-[42%] landscape:translate-y-[12%]"
              />
            </div>
            <span className="text-[8px] font-bold uppercase tracking-tighter">{t.profile}</span>
          </button>
        </div>
      )}

      {/* Floating Trial Notification */}
      {dbUser && trialTimeLeft !== null && trialTimeLeft > 0 && showTrialNotification && (
        <div className="fixed top-6 right-6 md:top-8 md:right-8 z-[100000] animate-slide-in-right">
          <div className="bg-[#050605] border border-green-500/50 rounded-[1.5rem] overflow-hidden shadow-[0_0_30px_rgba(34,197,94,0.2)]">
            <div className="px-6 py-4 flex items-center gap-5 relative overflow-hidden">
              {/* Subtle wave pattern in background */}
              <div className="absolute inset-0 opacity-10 pointer-events-none">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(34,197,94,0.1),transparent_70%)]" />
              </div>

              {/* Green Checkmark Icon (Matching Image Style) */}
              <div className="relative shrink-0">
                {/* Decorative Sparkles */}
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full blur-[2px] animate-pulse" />
                <div className="absolute -bottom-2 -left-1 w-1.5 h-1.5 bg-yellow-400 rounded-full blur-[1px] animate-pulse delay-75" />
                
                <div className="w-14 h-14 rounded-full bg-green-500/10 border border-yellow-500/50 flex items-center justify-center relative">
                   {/* Glow layer */}
                   <div className="absolute inset-0 rounded-full bg-yellow-500/20 blur-md" />
                   
                   {/* Main Circle */}
                   <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-[0_0_15px_rgba(234,179,8,0.5)] border-2 border-yellow-400 z-10">
                    <Check size={20} className="text-[#050605]" strokeWidth={5} />
                   </div>

                   {/* Secondary rings */}
                   <div className="absolute inset-0 rounded-full border border-yellow-500/30 opacity-50 scale-110" />
                </div>
              </div>

              {/* Text (Matching Image Style) */}
              <div className="flex flex-col z-10">
                <div className="text-xl font-bold text-white tracking-tight leading-tight">
                  {language === 'ru' ? 'Выдан пробный период' : 'Trial period granted'}
                </div>
                <div className="text-base font-bold text-green-500 mt-0.5 opacity-90">
                  {language === 'ru' ? 'на 2 дня.' : 'for 2 days.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Settings Modal */}
      {isMobileSettingsOpen && (
        <div className="md:hidden fixed inset-0 z-[30000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#0d0d0d] border border-white/10 rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-purple-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/20 rounded-xl">
                  <Settings size={20} className="text-purple-400" />
                </div>
                <h3 className="text-lg font-black uppercase tracking-widest text-white">{t.settings}</h3>
              </div>
              <button onClick={() => setIsMobileSettingsOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-all">
                <X size={20} className="text-gray-400" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">{t.market_data}</h4>
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/5">
                    <span className="text-xs font-bold text-gray-400">{t.language}</span>
                    <LanguageSwitcher language={language} setLanguage={setLanguage} />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/5 space-y-3">
                <button 
                  onClick={() => {
                    setIsMobileSettingsOpen(false);
                    resetToDefault('SPOT');
                    resetToDefault('FUTURES');
                  }}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-xs font-black uppercase tracking-widest text-gray-400 hover:text-white transition-all flex items-center justify-center gap-2"
                >
                  <RotateCcw size={14} /> {t.retry}
                </button>

                <button 
                  onClick={() => {
                    setIsMobileSettingsOpen(false);
                    onLogout();
                  }}
                  className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-2xl text-xs font-black uppercase tracking-widest text-red-500 transition-all flex items-center justify-center gap-2"
                >
                  <LogOut size={14} /> {t.exit_btn}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showSubscriptionPrompt && (
        <SubscriptionPrompt 
          language={language} 
          onClose={() => setShowSubscriptionPrompt(false)} 
          onNavigateToSubscription={onNavigateToProfile}
        />
      )}
    </div>
  );
};

export default Dashboard;
