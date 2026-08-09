import React from 'react';

interface KpiCardProps {
  label: string;
  value: number | string;
  sub?: string;
  accent?: 'live' | 'error';
}

export function KpiCard({ label, value, sub, accent }: KpiCardProps) {
  return (
    <div className={`overview-kpi${accent ? ` overview-kpi--${accent}` : ''}`}>
      <div className="overview-kpi-label">{label}</div>
      <div className="overview-kpi-value">{value}</div>
      {sub && <div className="overview-kpi-sub">{sub}</div>}
    </div>
  );
}
