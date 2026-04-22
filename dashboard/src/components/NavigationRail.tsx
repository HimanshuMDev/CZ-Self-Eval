import React from 'react';
import { Layout, Shield, History, Settings, Bot, FlaskConical, MessageCircle, ClipboardList, ChevronRight, BarChart2, TrendingUp, Award } from 'lucide-react';
import { useDashboard } from '../store/DashboardContext';

const NavigationRail: React.FC = () => {
  const { currentView, setView } = useDashboard();

  const navGroups = [
    {
      label: 'Testing',
      items: [
        { id: 'arena',        icon: Layout,       label: 'Arena',          desc: 'Dual-agent simulation' },
        { id: 'chat',         icon: MessageCircle,label: 'Live Chat',       desc: 'Real-time chat test' },
        { id: 'chat-history', icon: ClipboardList, label: 'Chat History',  desc: 'Review sessions' },
        { id: 'eval-review',  icon: BarChart2,    label: 'Eval Review',    desc: 'All flags & comments' },
        { id: 'golden',       icon: Award,        label: 'Golden Set',     desc: 'Locked baseline · CI' },
      ]
    },
    {
      label: 'Tools',
      items: [
        { id: 'sandbox',  icon: FlaskConical, label: 'Questions Lab', desc: 'Edge-case scenarios' },
        { id: 'evidence', icon: Shield,       label: 'Evidence',      desc: 'Failing traces' },
        { id: 'metrics',  icon: TrendingUp,   label: 'Metrics',       desc: 'Health & trends' },
        { id: 'history',  icon: History,      label: 'History',       desc: 'Eval trajectory' },
      ]
    }
  ];

  return (
    <nav
      className="w-56 shrink-0 flex flex-col overflow-hidden"
      style={{
        background: '#ffffff',
        borderRight: '1px solid #F0F1F5',
        boxShadow: '2px 0 12px rgba(0,0,0,0.04)',
      }}
    >
      {/* Brand */}
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-center gap-3">
          {/* Logo mark */}
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 relative"
            style={{
              background: 'linear-gradient(135deg, #F97316 0%, #fb923c 100%)',
              boxShadow: '0 4px 16px rgba(249,115,22,0.38), 0 1px 4px rgba(249,115,22,0.2)',
            }}
          >
            <Bot style={{ width: '18px', height: '18px', color: '#fff' }} />
            {/* Pulse dot */}
            <span
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white"
              style={{ background: '#F97316', boxShadow: '0 0 0 2px rgba(249,115,22,0.25)' }}
            />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span
              className="text-[13.5px] font-black tracking-tight truncate"
              style={{ color: '#0f172a', letterSpacing: '-0.02em' }}
            >
              Agent Arena
            </span>
            <span
              className="text-[9px] font-bold uppercase tracking-[0.16em] mt-0.5"
              style={{ color: '#F97316', opacity: 0.8 }}
            >
              Self-Eval · Pro
            </span>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 mb-4" style={{ height: '1px', background: 'linear-gradient(90deg, transparent, #F0F1F5, transparent)' }} />

      {/* Nav groups */}
      <div className="flex-1 px-3 space-y-5 overflow-y-auto">
        {navGroups.map(group => (
          <div key={group.label}>
            <p
              className="text-[9px] font-black uppercase px-3 mb-2"
              style={{ color: '#c1c9d4', letterSpacing: '0.14em' }}
            >
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id as any)}
                    className="relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[12.5px] font-semibold transition-all duration-150 w-full text-left group overflow-hidden"
                    style={{
                      background: active
                        ? 'linear-gradient(100deg, rgba(249,115,22,0.1) 0%, rgba(249,115,22,0.04) 100%)'
                        : 'transparent',
                      color: active ? '#ea580c' : '#64748b',
                      border: active ? '1px solid rgba(249,115,22,0.18)' : '1px solid transparent',
                    }}
                    onMouseEnter={e => {
                      if (!active) {
                        (e.currentTarget as HTMLElement).style.background = '#F8F9FB';
                        (e.currentTarget as HTMLElement).style.color = '#374151';
                        (e.currentTarget as HTMLElement).style.border = '1px solid #EEF0F5';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!active) {
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                        (e.currentTarget as HTMLElement).style.color = '#64748b';
                        (e.currentTarget as HTMLElement).style.border = '1px solid transparent';
                      }
                    }}
                  >
                    {/* Left accent bar */}
                    {active && (
                      <div
                        className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
                        style={{ background: 'linear-gradient(180deg, #F97316, #fb923c)' }}
                      />
                    )}

                    {/* Icon container */}
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: active
                          ? 'rgba(249,115,22,0.12)'
                          : 'transparent',
                        transition: 'background 0.15s',
                      }}
                    >
                      <item.icon
                        style={{
                          width: '14px',
                          height: '14px',
                          flexShrink: 0,
                          color: active ? '#F97316' : 'currentColor',
                        }}
                      />
                    </div>

                    <span style={{ letterSpacing: '-0.01em' }}>{item.label}</span>

                    {active && (
                      <ChevronRight
                        className="ml-auto shrink-0 opacity-50"
                        style={{ width: '12px', height: '12px', color: '#F97316' }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom */}
      <div className="px-3 pb-5 pt-4">
        <div
          className="mx-2 mb-4"
          style={{ height: '1px', background: 'linear-gradient(90deg, transparent, #F0F1F5, transparent)' }}
        />
        <button
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[12.5px] font-semibold w-full transition-all"
          style={{ color: '#94a3b8', border: '1px solid transparent' }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = '#F8F9FB';
            (e.currentTarget as HTMLElement).style.color = '#475569';
            (e.currentTarget as HTMLElement).style.border = '1px solid #EEF0F5';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = '#94a3b8';
            (e.currentTarget as HTMLElement).style.border = '1px solid transparent';
          }}
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center">
            <Settings style={{ width: '14px', height: '14px' }} />
          </div>
          <span>Settings</span>
        </button>

        {/* Status indicator */}
        <div
          className="mx-1 mt-2 flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{
            background: 'rgba(249,115,22,0.06)',
            border: '1px solid rgba(249,115,22,0.14)',
          }}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
              style={{ background: '#F97316' }}
            />
            <span
              className="relative inline-flex rounded-full h-2 w-2"
              style={{ background: '#F97316' }}
            />
          </span>
          <span
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color: 'rgba(249,115,22,0.7)' }}
          >
            Systems Live
          </span>
        </div>
      </div>
    </nav>
  );
};

export default NavigationRail;
