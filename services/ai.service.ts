
import { RowData } from "../models";

const ANALYSIS_CACHE = new Map<string, { data: AIInsightResponse, timestamp: number }>();
const CACHE_TTL = 3600000; // 1 hour

export interface AIInsightResponse {
  analysis: string;
  why: string[];
  brief: string[];
  metrics: {
    price: string;
    cap: string;
    volume: string;
    supply: string;
    rank?: string;
    ath?: string;
    atl?: string;
    news: string;
    protocol: string;
    protocolTitle: string;
  };
  sources: { title: string; uri: string }[];
}

export class AIService {
  static async analyzeAsset(asset: RowData, language: 'ru' | 'en' = 'ru', model: string = 'gemini-3-flash-preview'): Promise<AIInsightResponse> {
    const ticker = asset.pair.replace(/USDT$|BUSD$|BTC$|ETH$/, '');
    const cacheKey = `${ticker}_${language}`;

    const cached = ANALYSIS_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      console.log(`Using cached AI analysis for ${ticker}`);
      return cached.data;
    }
    
    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, language, model })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 429) {
          throw new Error("AI_QUOTA_EXCEEDED");
        }
        throw new Error(errorData.message || `AI extraction failed: ${response.statusText}`);
      }

      const result: AIInsightResponse = await response.json();
      ANALYSIS_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    } catch (error) {
      console.error("Data Extraction Error:", error);
      throw error;
    }
  }

  static async analyzeMarket(densities: RowData[], language: 'ru' | 'en' = 'ru'): Promise<AIInsightResponse> {
    return {
      analysis: "Market scan functionality is currently focused on individual asset data extraction.",
      why: [],
      brief: [],
      metrics: {
        price: '', cap: '', volume: '', supply: '', news: '', protocol: '', protocolTitle: ''
      },
      sources: []
    };
  }

  static async askQuestion(question: string, context: RowData[], language: 'ru' | 'en' = 'ru'): Promise<string> {
    try {
      const response = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context, language })
      });

      if (!response.ok) {
        if (response.status === 429) return "Assistant quota exceeded. Please try again later.";
        const errorData = await response.json().catch(() => ({}));
        return errorData.message || "Assistant unavailable.";
      }

      const data = await response.json();
      return data.text || "I'm sorry, I couldn't generate an answer.";
    } catch (e) {
      console.error("AI Ask Error:", e);
      return "Assistant unavailable.";
    }
  }
}

