'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  Users,
  Key,
  History,
  Plus,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
} from 'lucide-react';
import { serverApi } from '@/shared/apiClient';

export const SecurityAdminCard: React.FC = () => {
  const [subTab, setSubTab] = useState<'users' | 'keys' | 'audit'>('users');

  // Users State
  const [users, setUsers] = useState<any[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'READ_ONLY' | 'OPERATOR' | 'ADMIN' | 'ROOT'>('OPERATOR');
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [userMsg, setUserMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // API Keys State
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyRole, setNewKeyRole] = useState<'READ_ONLY' | 'OPERATOR' | 'ADMIN' | 'ROOT'>('OPERATOR');
  const [newKeyExpiry, setNewKeyExpiry] = useState<number>(30);
  const [createdSecretKey, setCreatedSecretKey] = useState<string | null>(null);
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  const fetchUsers = useCallback(async () => {
    setIsLoadingUsers(true);
    try {
      const res = await serverApi.getUsers();
      setUsers(Array.isArray(res) ? res : []);
    } catch {
      setUsers([]);
    } finally {
      setIsLoadingUsers(false);
    }
  }, []);

  const fetchKeys = useCallback(async () => {
    setIsLoadingKeys(true);
    try {
      const res = await serverApi.getApiKeys();
      setApiKeys(Array.isArray(res) ? res : []);
    } catch {
      setApiKeys([]);
    } finally {
      setIsLoadingKeys(false);
    }
  }, []);

  const fetchAudit = useCallback(async () => {
    setIsLoadingAudit(true);
    try {
      const res = await serverApi.getAuditLogs(100);
      setAuditLogs(Array.isArray(res) ? res : []);
    } catch {
      setAuditLogs([]);
    } finally {
      setIsLoadingAudit(false);
    }
  }, []);

  useEffect(() => {
    if (subTab === 'users') fetchUsers();
    if (subTab === 'keys') fetchKeys();
    if (subTab === 'audit') fetchAudit();
  }, [subTab, fetchUsers, fetchKeys, fetchAudit]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserMsg(null);
    setIsCreatingUser(true);
    try {
      const res = await serverApi.createUser({
        username: newUsername,
        password: newPassword,
        role: newRole,
      });
      if (res && res.id) {
        setUserMsg({ type: 'success', text: `User '${newUsername}' created successfully!` });
        setNewUsername('');
        setNewPassword('');
        fetchUsers();
      } else {
        setUserMsg({ type: 'error', text: res.error || 'Failed to create user' });
      }
    } catch (err: any) {
      setUserMsg({ type: 'error', text: err.message });
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreatingKey(true);
    setCreatedSecretKey(null);
    try {
      const res = await serverApi.createApiKey({
        name: newKeyName,
        role: newKeyRole,
        expiresInDays: newKeyExpiry > 0 ? newKeyExpiry : undefined,
      });
      if (res && res.apiKey) {
        setCreatedSecretKey(res.apiKey);
        setNewKeyName('');
        fetchKeys();
      }
    } catch (err: any) {
      alert(`Error creating key: ${err.message}`);
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This action is immediate and cannot be undone.')) {
      return;
    }
    await serverApi.revokeApiKey(id);
    fetchKeys();
  };

  const handleCopyKey = () => {
    if (!createdSecretKey) return;
    navigator.clipboard.writeText(createdSecretKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & SubTabs */}
      <div className="glass-card rounded-2xl p-6 border border-slate-800 bg-slate-900/40">
        <div className="flex flex-wrap items-center justify-between pb-4 border-b border-slate-800 mb-4 gap-3">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Security &amp; Identity Core</h2>
              <p className="text-xs text-slate-400">
                RBAC user roles, secret API keys, and immutable audit logs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setSubTab('users')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                subTab === 'users'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Users &amp; Roles</span>
            </button>
            <button
              onClick={() => setSubTab('keys')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                subTab === 'keys'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              <span>API Keys</span>
            </button>
            <button
              onClick={() => setSubTab('audit')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                subTab === 'audit'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Audit Log</span>
            </button>
          </div>
        </div>

        {/* ========================================== */}
        {/* TAB 1: USERS & ROLES */}
        {/* ========================================== */}
        {subTab === 'users' && (
          <div className="space-y-6">
            {/* Create User Form */}
            <form onSubmit={handleCreateUser} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
              <h4 className="text-xs font-semibold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-purple-400" />
                <span>Create New Account</span>
              </h4>

              {userMsg && (
                <div
                  className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                    userMsg.type === 'success'
                      ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
                  }`}
                >
                  {userMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  <span>{userMsg.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">Username</label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="e.g. operator_john"
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="min 8 chars"
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">Role</label>
                  <select
                    value={newRole}
                    onChange={(e: any) => setNewRole(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-purple-300 focus:outline-none focus:border-purple-500"
                  >
                    <option value="READ_ONLY">READ_ONLY (Metrics &amp; Viewing)</option>
                    <option value="OPERATOR">OPERATOR (Start/Stop Services)</option>
                    <option value="ADMIN">ADMIN (Routes, Caddy, Delete)</option>
                    <option value="ROOT">ROOT (Full System Authority)</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={isCreatingUser}
                    className="w-full py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition-all shadow-md shadow-purple-600/20 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {isCreatingUser ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>Create User</span>
                  </button>
                </div>
              </div>
            </form>

            {/* Users Table */}
            <div>
              <h4 className="text-xs font-semibold text-white mb-2">Registered Accounts</h4>
              {isLoadingUsers ? (
                <div className="p-8 text-center text-xs text-slate-500">Loading accounts...</div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-black/40">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 font-mono text-[10px] uppercase">
                        <th className="py-2.5 px-3">Username</th>
                        <th className="py-2.5 px-3">Role</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {users.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-semibold text-white">{u.username}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] border ${
                                u.role === 'ROOT'
                                  ? 'bg-purple-500/10 text-purple-300 border-purple-500/30 font-bold'
                                  : u.role === 'ADMIN'
                                  ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                                  : u.role === 'OPERATOR'
                                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                  : 'bg-slate-500/10 text-slate-300 border-slate-500/30'
                              }`}
                            >
                              {u.role}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-emerald-400">
                            {u.isActive ? 'Active' : 'Disabled'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">
                            {new Date(u.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================== */}
        {/* TAB 2: API KEYS */}
        {/* ========================================== */}
        {subTab === 'keys' && (
          <div className="space-y-6">
            {/* Create API Key Form */}
            <form onSubmit={handleCreateKey} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
              <h4 className="text-xs font-semibold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-purple-400" />
                <span>Generate Secret API Key (32-byte)</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">Key Name / Client</label>
                  <input
                    type="text"
                    required
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g. Mobile Client / CI Bot"
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">Role Privilege</label>
                  <select
                    value={newKeyRole}
                    onChange={(e: any) => setNewKeyRole(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-purple-300 focus:outline-none focus:border-purple-500"
                  >
                    <option value="READ_ONLY">READ_ONLY</option>
                    <option value="OPERATOR">OPERATOR</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="ROOT">ROOT</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-500 mb-1">Expires In (Days)</label>
                  <input
                    type="number"
                    value={newKeyExpiry}
                    onChange={(e) => setNewKeyExpiry(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={isCreatingKey}
                    className="w-full py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition-all shadow-md shadow-purple-600/20 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {isCreatingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>Generate Key</span>
                  </button>
                </div>
              </div>
            </form>

            {/* Generated Secret Key Alert Banner */}
            {createdSecretKey && (
              <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-500/40 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-purple-300 flex items-center gap-1.5">
                    <Lock className="w-4 h-4 text-purple-400" />
                    <span>Copy API Key Secret (Visible Once Only)</span>
                  </span>
                  <button
                    onClick={handleCopyKey}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white font-medium text-[11px] transition-colors"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey ? 'Copied!' : 'Copy Key'}</span>
                  </button>
                </div>
                <code className="block p-2 rounded bg-black/60 border border-purple-800/40 font-mono text-purple-200 select-all break-all">
                  {createdSecretKey}
                </code>
                <p className="text-[11px] text-purple-300/80">
                  Pass this secret in the <span className="font-mono text-white">x-api-key</span> header for external REST clients.
                </p>
              </div>
            )}

            {/* Keys Table */}
            <div>
              <h4 className="text-xs font-semibold text-white mb-2">Active API Keys</h4>
              {isLoadingKeys ? (
                <div className="p-8 text-center text-xs text-slate-500">Loading API keys...</div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-black/40">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 font-mono text-[10px] uppercase">
                        <th className="py-2.5 px-3">Name</th>
                        <th className="py-2.5 px-3">Prefix</th>
                        <th className="py-2.5 px-3">Role</th>
                        <th className="py-2.5 px-3">Expires</th>
                        <th className="py-2.5 px-3">Last Used</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {apiKeys.map((k) => (
                        <tr key={k.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-semibold text-white">{k.name}</td>
                          <td className="py-2.5 px-3 text-purple-300">{k.prefix}...</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                              {k.role}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">
                            {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">
                            {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={() => handleRevokeKey(k.id)}
                              className="p-1 rounded hover:bg-rose-950/60 text-rose-400 transition-colors"
                              title="Revoke Key"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================== */}
        {/* TAB 3: AUDIT LOGS */}
        {/* ========================================== */}
        {subTab === 'audit' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-white">Immutable Security Audit Logs (v2)</h4>
              <button
                onClick={fetchAudit}
                disabled={isLoadingAudit}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono"
              >
                Refresh Logs
              </button>
            </div>

            {isLoadingAudit ? (
              <div className="p-8 text-center text-xs text-slate-500">Loading audit events...</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-black/40">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 font-mono text-[10px] uppercase">
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3">Actor</th>
                      <th className="py-2.5 px-3">Action</th>
                      <th className="py-2.5 px-3">IP Address</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-white">
                          {log.actorName || 'anonymous'}
                        </td>
                        <td className="py-2.5 px-3 text-purple-300 whitespace-nowrap">
                          {log.action}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {log.ipAddress || '-'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] border ${
                              log.status === 'success'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            }`}
                          >
                            {log.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 max-w-xs truncate">
                          {log.details || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
