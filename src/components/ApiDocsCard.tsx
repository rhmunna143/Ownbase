'use client';

import React, { useState, useEffect } from 'react';
import {
  Code,
  Terminal,
  Send,
  Copy,
  Check,
  Download,
  BookOpen,
  Search,
  ExternalLink,
  Layers,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Cpu,
  HardDrive,
  Camera,
  Database,
  Globe,
  Shield,
  Bot,
} from 'lucide-react';
import { serverApi } from '@/shared/apiClient';
import { ApiEndpointDoc } from '@/shared/types';

export const ApiDocsCard: React.FC = () => {
  const [endpoints, setEndpoints] = useState<ApiEndpointDoc[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Try it out states
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [requestBodies, setRequestBodies] = useState<Record<string, string>>({});
  const [responses, setResponses] = useState<Record<string, { status: number; durationMs: number; data: any; error?: string }>>({});
  const [isExecuting, setIsExecuting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    serverApi.getApiEndpoints().then((eps) => {
      setEndpoints(eps);
      // Pre-fill sample bodies
      const initialBodies: Record<string, string> = {};
      eps.forEach((ep) => {
        if (ep.sampleRequest && typeof ep.sampleRequest === 'object') {
          initialBodies[ep.id] = JSON.stringify(ep.sampleRequest, null, 2);
        }
      });
      setRequestBodies(initialBodies);
    });
  }, []);

  const categories = ['All', ...Array.from(new Set(endpoints.map((ep) => ep.category)))];

  const handleCopyCurl = (ep: ApiEndpointDoc) => {
    let curl = `curl -X ${ep.method} "http://localhost:3001${ep.path}"`;
    if (ep.method !== 'GET' && requestBodies[ep.id]) {
      curl += ` -H "Content-Type: application/json" -d '${requestBodies[ep.id].replace(/\n/g, '')}'`;
    }
    navigator.clipboard.writeText(curl);
    setCopiedId(ep.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleTryItOut = async (ep: ApiEndpointDoc) => {
    setIsExecuting((prev) => ({ ...prev, [ep.id]: true }));
    const startTime = performance.now();

    try {
      const url = ep.path.startsWith('/') ? ep.path : `/${ep.path}`;
      const options: RequestInit = {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
      };

      if (ep.method !== 'GET') {
        const bodyText = requestBodies[ep.id] || (ep.sampleRequest ? JSON.stringify(ep.sampleRequest) : undefined);
        if (bodyText) {
          options.body = bodyText;
        }
      }

      const res = await fetch(url, options);
      const endTime = performance.now();
      const contentType = res.headers.get('content-type') || '';

      let data: any;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        data = await res.text();
      }

      setResponses((prev) => ({
        ...prev,
        [ep.id]: {
          status: res.status,
          durationMs: Math.round(endTime - startTime),
          data,
        },
      }));
    } catch (err: any) {
      const endTime = performance.now();
      setResponses((prev) => ({
        ...prev,
        [ep.id]: {
          status: 0,
          durationMs: Math.round(endTime - startTime),
          data: null,
          error: err.message,
        },
      }));
    } finally {
      setIsExecuting((prev) => ({ ...prev, [ep.id]: false }));
    }
  };

  const getMethodBadge = (method: string) => {
    switch (method) {
      case 'GET':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'POST':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'DELETE':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      case 'PUT':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  const filteredEndpoints = endpoints.filter((ep) => {
    const matchesCategory = selectedCategory === 'All' || ep.category === selectedCategory;
    const matchesQuery =
      ep.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="space-y-4">
      {/* Top Banner Card */}
      <div className="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 bg-slate-900/60 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <Code className="w-5 h-5 text-emerald-400" />
              <span>Universal REST API &amp; SDK Explorer</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                OpenAPI 3.0 Ready
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Complete, mobile-ready REST APIs to build mobile apps (Flutter, React Native, Swift, Kotlin) and custom dashboards.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/api/openapi.json"
              target="_blank"
              download="openapi.json"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold shadow-sm transition-colors"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>OpenAPI Spec</span>
            </a>

            <a
              href="https://swagger.io/tools/swagger-ui/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Postman / Swagger</span>
            </a>
          </div>
        </div>

        {/* Category Pills & Search */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-thin">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shrink-0 ${
                  selectedCategory === cat
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                    : 'bg-slate-800/60 text-slate-400 hover:text-white'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-64 shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter endpoints..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Endpoints List */}
      <div className="space-y-3">
        {filteredEndpoints.map((ep) => {
          const isExpanded = expandedId === ep.id;
          const resp = responses[ep.id];

          return (
            <div
              key={ep.id}
              className="glass-card rounded-2xl border border-slate-800/80 bg-slate-900/40 hover:border-slate-700/80 transition-all overflow-hidden"
            >
              {/* Endpoint Header Strip */}
              <div
                onClick={() => setExpandedId(isExpanded ? null : ep.id)}
                className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-slate-850/50 transition-colors"
              >
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  <span
                    className={`text-[10px] sm:text-xs font-mono font-bold px-2 py-0.5 rounded-lg border ${getMethodBadge(
                      ep.method
                    )}`}
                  >
                    {ep.method}
                  </span>
                  <span className="text-xs sm:text-sm font-mono font-semibold text-white truncate">{ep.path}</span>
                  <span className="text-xs text-slate-400 hidden lg:inline truncate">— {ep.summary}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 hidden sm:inline">
                    {ep.category}
                  </span>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyCurl(ep);
                    }}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Copy cURL"
                  >
                    {copiedId === ep.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>

                  <div className="p-1 text-slate-400">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>
              </div>

              {/* Expanded Interactive Body */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-2 border-t border-slate-800/80 space-y-4 bg-slate-950/40">
                  <p className="text-xs text-slate-300">{ep.description}</p>

                  {/* Parameters Table */}
                  {ep.parameters && ep.parameters.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Parameters</h4>
                      <div className="overflow-x-auto rounded-xl border border-slate-800">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-900/80 text-slate-400 text-[10px] font-mono uppercase">
                            <tr>
                              <th className="p-2.5">Name</th>
                              <th className="p-2.5">In</th>
                              <th className="p-2.5">Type</th>
                              <th className="p-2.5">Description</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800 text-slate-300 font-mono text-[11px]">
                            {ep.parameters.map((p) => (
                              <tr key={p.name} className="hover:bg-slate-850/40">
                                <td className="p-2.5 font-bold text-white flex items-center gap-1">
                                  {p.name}
                                  {p.required && <span className="text-rose-400 text-[9px]">*</span>}
                                </td>
                                <td className="p-2.5 text-slate-400">{p.in}</td>
                                <td className="p-2.5 text-blue-400">{p.type}</td>
                                <td className="p-2.5 text-slate-300 font-sans text-xs">{p.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Request Body Editor (for POST/PUT) */}
                  {ep.method !== 'GET' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Request Payload (JSON)</h4>
                        <span className="text-[10px] text-slate-500 font-mono">application/json</span>
                      </div>
                      <textarea
                        rows={4}
                        value={requestBodies[ep.id] || ''}
                        onChange={(e) =>
                          setRequestBodies((prev) => ({ ...prev, [ep.id]: e.target.value }))
                        }
                        className="w-full p-3 text-xs font-mono bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-blue-500/60"
                      />
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTryItOut(ep)}
                        disabled={isExecuting[ep.id]}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all disabled:opacity-50 min-h-[38px] touch-manipulation"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{isExecuting[ep.id] ? 'Executing...' : 'Try It Out'}</span>
                      </button>

                      <button
                        onClick={() => handleCopyCurl(ep)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy cURL</span>
                      </button>
                    </div>

                    {resp && (
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span
                          className={`px-2 py-0.5 rounded-md ${
                            resp.status >= 200 && resp.status < 300
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          Status: {resp.status}
                        </span>
                        <span className="text-slate-500">{resp.durationMs}ms</span>
                      </div>
                    )}
                  </div>

                  {/* Live Response Viewer */}
                  {resp && (
                    <div className="space-y-1.5 pt-2 border-t border-slate-800">
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Live Response</h4>
                      <pre className="p-3 text-xs font-mono bg-slate-950 border border-slate-800 rounded-xl text-emerald-300 overflow-x-auto max-h-60 selection:bg-emerald-600">
                        {typeof resp.data === 'object' ? JSON.stringify(resp.data, null, 2) : resp.data || resp.error}
                      </pre>
                    </div>
                  )}

                  {/* Sample Response */}
                  {!resp && ep.sampleResponse && (
                    <div className="space-y-1.5">
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Sample Response (200 OK)</h4>
                      <pre className="p-3 text-xs font-mono bg-slate-950 border border-slate-800 rounded-xl text-slate-300 overflow-x-auto max-h-48">
                        {typeof ep.sampleResponse === 'object'
                          ? JSON.stringify(ep.sampleResponse, null, 2)
                          : ep.sampleResponse}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
