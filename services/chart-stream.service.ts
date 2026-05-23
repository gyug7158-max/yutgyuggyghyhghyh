
import { Subject, BehaviorSubject } from 'rxjs';
import { throttleTime } from 'rxjs/operators';

export interface TickerData {
  symbol: string;
  price: number;
  exchange: string;
  marketType: 'SPOT' | 'FUTURES';
}

export class ChartStreamService {
  private static instance: ChartStreamService;
  private tickerSubject = new Subject<TickerData>();
  public ticker$ = this.tickerSubject.asObservable().pipe(throttleTime(50));
  public connectionStatus$ = new BehaviorSubject<'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED'>('DISCONNECTED');

  private socket: WebSocket | null = null;
  private reconnectTimer: any = null;
  private watchdogTimer: any = null;
  private lastMessageTime = Date.now();
  private tickerConfigs = new Map<string, number>();

  private constructor() {
    this.connect();
    this.startWatchdog();
  }

  public static getInstance(): ChartStreamService {
    if (!ChartStreamService.instance) {
      ChartStreamService.instance = new ChartStreamService();
    }
    return ChartStreamService.instance;
  }

  private startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      const now = Date.now();
      // If we are connected but haven't received a message for 15s, reconnect
      if (this.socket?.readyState === WebSocket.OPEN && (now - this.lastMessageTime > 15000)) {
        console.log("[ChartStream] Watchdog: No data for 15s, reconnecting...");
        this.socket.close();
      }
    }, 5000);
  }

  private connect() {
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      try { this.socket.close(); } catch (e) {}
    }

    const proxyUrl = (import.meta as any).env?.VITE_WS_PROXY_URL;
    let wsUrl: string;

    if (proxyUrl) {
      wsUrl = proxyUrl.replace(/\/ws\/(densities|charts)/, '') + '/ws/charts';
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      wsUrl = `${protocol}//${host}/ws/charts`;
    }

    try {
      this.socket = new WebSocket(wsUrl);
      this.connectionStatus$.next('RECONNECTING');

      this.socket.onopen = () => {
        console.log("[ChartStream] Connected to /ws/charts");
        this.connectionStatus$.next('CONNECTED');
        this.lastMessageTime = Date.now();
        this.reSubscribeAll();
      };

      this.socket.onclose = () => {
        if (this.connectionStatus$.value !== 'RECONNECTING') {
          this.connectionStatus$.next('DISCONNECTED');
        }
        this.handleReconnect();
      };

      this.socket.onerror = () => {
        this.connectionStatus$.next('DISCONNECTED');
        this.handleReconnect();
      };

      this.socket.onmessage = (ev) => {
        this.lastMessageTime = Date.now();
        try {
          const payload = JSON.parse(ev.data);
          if (payload.type === "EXCHANGE_DATA" && payload.dataType === 'TICKER') {
            const { exchange, marketType, data } = payload;
            const symbol = (data.s || data.symbol || data.data?.s || data.topic?.split('.').pop())?.toUpperCase();
            const price = parseFloat(data.c || data.lastPrice || data.data?.lastPrice || data.p);
            if (symbol && !isNaN(price)) {
              this.tickerSubject.next({ symbol, price, exchange, marketType });
            }
          }
        } catch (e) {
          console.error("[ChartStream] Message error:", e);
        }
      };
    } catch (e) {
      this.handleReconnect();
    }
  }

  private handleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }

  private reSubscribeAll() {
    if (this.socket?.readyState === WebSocket.OPEN && this.tickerConfigs.size > 0) {
      const tickers: any[] = [];
      this.tickerConfigs.forEach((count, key) => {
        const [exchange, marketType, symbol] = key.split('|');
        tickers.push({ exchange, marketType, symbol });
      });
      this.socket.send(JSON.stringify({ type: "SUBSCRIBE_TICKERS", tickers }));
    }
  }

  public subscribeTicker(symbol: string, exchange: string, marketType: string) {
    const key = `${exchange}|${marketType}|${symbol}`;
    const currentCount = this.tickerConfigs.get(key) || 0;
    this.tickerConfigs.set(key, currentCount + 1);

    if (currentCount === 0) {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          type: "SUBSCRIBE_TICKERS",
          tickers: [{ symbol, exchange, marketType }]
        }));
      }
    }
  }

  public unsubscribeTicker(symbol: string, exchange: string, marketType: string) {
    const key = `${exchange}|${marketType}|${symbol}`;
    const currentCount = this.tickerConfigs.get(key) || 0;
    if (currentCount <= 1) {
      this.tickerConfigs.delete(key);
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          type: "UNSUBSCRIBE_TICKERS",
          tickers: [{ symbol, exchange, marketType }]
        }));
      }
    } else {
      this.tickerConfigs.set(key, currentCount - 1);
    }
  }
}

export const chartStreamService = ChartStreamService.getInstance();
