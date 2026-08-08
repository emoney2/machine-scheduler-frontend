import React from 'react';
import { formatConflictMachines } from './utils/threadConflicts';

/**
 * Detail panel / modal for one or more thread concurrency conflicts.
 */
export default function ThreadConflictPanel({
  conflicts = [],
  title = 'Thread conflict',
  onClose,
  onSelectConflict,
  selectedId,
}) {
  if (!conflicts.length) return null;

  const active =
    conflicts.find((c) => c.id === selectedId) || conflicts[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 10050,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(640px, 100%)',
          maxHeight: '85vh',
          overflow: 'auto',
          background: '#fff',
          borderRadius: 10,
          border: '1px solid #e5e7eb',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          padding: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#111827' }}>{title}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              The same thread color is on more than one machine, and you do not have enough cones
              to load them all at once.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: '1px solid #d1d5db',
              background: '#fff',
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Close
          </button>
        </div>

        {conflicts.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {conflicts.map((c) => {
              const selected = c.id === active.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectConflict?.(c.id)}
                  style={{
                    fontSize: 12,
                    padding: '4px 8px',
                    borderRadius: 999,
                    border: selected ? '1px solid #ca8a04' : '1px solid #e5e7eb',
                    background: selected ? '#fef9c3' : '#f9fafb',
                    cursor: 'pointer',
                    fontWeight: selected ? 700 : 500,
                  }}
                >
                  {c.color}
                  {c.preferBuy ? ' · buy' : ' · reschedule'}
                </button>
              );
            })}
          </div>
        )}

        <ConflictBody conflict={active} />
      </div>
    </div>
  );
}

function ConflictBody({ conflict }) {
  if (!conflict) return null;
  const badge = conflict.preferBuy
    ? { bg: '#fee2e2', fg: '#991b1b', text: 'Buy recommended' }
    : { bg: '#fef9c3', fg: '#854d0e', text: 'Reschedule preferred' };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0.5 }}>{conflict.color}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: 999,
            background: badge.bg,
            color: badge.fg,
          }}
        >
          {badge.text}
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          {formatConflictMachines(conflict)}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <Stat label="On hand" value={`${conflict.availableCones} cones`} />
        <Stat label="Needed" value={`${conflict.peakConesNeeded} cones`} />
        <Stat label="Shortfall" value={`${conflict.shortfall} cones`} accent="#b45309" />
        <Stat
          label={conflict.preferBuy ? 'Buy' : 'Optional buy'}
          value={`${conflict.conesToBuy} cones`}
          accent={conflict.preferBuy ? '#991b1b' : '#854d0e'}
        />
      </div>

      {conflict.onOrderCones > 0 && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
          On order: {conflict.onOrderCones} cones (not counted until received).
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Jobs sharing this color</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {(conflict.jobs || []).map((j) => (
          <div
            key={`${conflict.color}-${j.id}-${j.machineKey}`}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              background: j.isLate ? '#fff1f2' : '#fafafa',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong>#{j.id}</strong>
              <span style={{ color: '#374151' }}>{j.machineTitle} · {j.conesNeeded} cones</span>
            </div>
            <div style={{ color: '#4b5563', marginTop: 2 }}>
              {[j.company, j.design || j.product].filter(Boolean).join(' · ')}
            </div>
            {(j.isLate || j.due_type) && (
              <div style={{ color: '#6b7280', marginTop: 2 }}>
                {j.isLate ? 'LATE' : ''}
                {j.isLate && j.due_type ? ' · ' : ''}
                {j.due_type || ''}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Suggestions</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#374151', lineHeight: 1.45 }}>
        {(conflict.suggestions || []).map((s, i) => (
          <li key={i} style={{ marginBottom: 4 }}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '8px 10px',
        background: '#f9fafb',
      }}
    >
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: accent || '#111827', marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

/**
 * Compact strip shown above the scheduler board.
 */
export function ThreadConflictStrip({
  summary,
  conflicts,
  expanded,
  onToggle,
  onOpenConflict,
}) {
  const count = summary?.conflictCount || 0;
  if (!count) return null;

  return (
    <div
      style={{
        margin: '0 0 12px 0',
        border: '1px solid #facc15',
        background: '#fefce8',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: 13,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 22,
            height: 22,
            borderRadius: 999,
            background: '#facc15',
            color: '#713f12',
            fontWeight: 800,
            fontSize: 12,
          }}
        >
          {count}
        </span>
        <span style={{ fontWeight: 700, color: '#713f12' }}>
          Thread {count === 1 ? 'conflict' : 'conflicts'}
        </span>
        <span style={{ color: '#854d0e', fontSize: 12 }}>
          Same color on multiple machines · not enough cones
          {summary.buyCount ? ` · ${summary.buyCount} buy recommended` : ''}
        </span>
        <span style={{ marginLeft: 'auto', color: '#854d0e', fontSize: 12 }}>
          {expanded ? 'Hide' : 'Show'}
        </span>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid #fde68a', padding: '8px 12px 10px' }}>
          {(conflicts || []).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpenConflict(c.id)}
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'center',
                gap: 8,
                padding: '6px 4px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 12,
                borderRadius: 6,
              }}
            >
              <strong style={{ minWidth: 48 }}>{c.color}</strong>
              <span style={{ color: '#4b5563' }}>
                {formatConflictMachines(c)} · need {c.peakConesNeeded} · have {c.availableCones}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontWeight: 700,
                  color: c.preferBuy ? '#991b1b' : '#854d0e',
                  flexShrink: 0,
                }}
              >
                {c.preferBuy ? `Buy ${c.conesToBuy}` : 'Reschedule'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
