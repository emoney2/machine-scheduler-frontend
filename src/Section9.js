// File: frontend/src/Section9.jsx
import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { fmtMMDD, subWorkDays, parseDueDate } from './helpers';
import axios from 'axios';

export default function Section9(props) {
  const [status, setStatus] = useState('');
  const [threadInventoryStatus, setThreadInventoryStatus] = useState({});
  const [materialInventoryStatus, setMaterialInventoryStatus] = useState({});
  const {
    columns,
    setColumns,
    handleSync,
    syncStatus,
    showModal,
    setShowModal,
    onDragEnd,
    getChain,
    toggleLink,
    editPlaceholder,
    removePlaceholder,
    ph,
    setPh,
    submitPlaceholder,
    LIGHT_YELLOW,
    DARK_YELLOW,
    LIGHT_GREY,
    DARK_GREY,
    LIGHT_PURPLE,
    DARK_PURPLE,
    LIGHT_ORANGE,
    DARK_ORANGE,
    LIGHT_BLUE,
    DARK_BLUE,
    BUBBLE_START,
    BUBBLE_END,
    BUBBLE_DELIV,
    // ⬇️ NEW: helpers passed from App.js
    toPreviewUrl,
    openArtwork
  } = props;

  // Ensure we never crash on missing columns (e.g. during initial load or parent bug)
  const safeColumns = columns ?? {
    queue: { title: 'Queue', jobs: [] },
    machine1: { title: 'Machine 1', headCount: 1, jobs: [] },
    machine2: { title: 'Machine 2', headCount: 6, jobs: [] }
  };

  // Fetch thread inventory: prefer status API; fallback to raw /threadInventory and derive red/yellow/green
  // Yellow = inventory negative but on-order (Inventory..) > 0
  useEffect(() => {
    const API_ROOT = (process.env.REACT_APP_API_ROOT || '/api').replace(/\/$/, '');
    const deriveStatus = (row) => {
      const inv = Number(row.inventory ?? row.Inventory ?? row.quantity ?? row.Quantity ?? 0);
      const onOrder = Number(row['Inventory..'] ?? row.onOrder ?? row.inventoryOnOrder ?? 0);
      if (inv < 0 && onOrder > 0) return 'yellow';
      if (inv < 0) return 'red';
      return 'green';
    };
    const fetchThreadStatus = async () => {
      try {
        const res = await axios.get(`${API_ROOT}/thread-inventory-status`, { withCredentials: true });
        const data = res.data;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          setThreadInventoryStatus(data);
          return;
        }
      } catch (_) {}
      try {
        const res = await axios.get(`${API_ROOT}/threadInventory`, { withCredentials: true });
        const arr = Array.isArray(res.data) ? res.data : [];
        const map = {};
        arr.forEach(row => {
          const code = String(row.value ?? row.threadColor ?? row.Value ?? row.code ?? '').trim();
          if (!code) return;
          map[code] = typeof row === 'object' && (row.inventory !== undefined || row.quantity !== undefined || row.Inventory !== undefined)
            ? deriveStatus(row)
            : (row.status ?? 'green');
        });
        setThreadInventoryStatus(map);
      } catch (_) {}
    };
    let interval = null;
    const boot = setTimeout(() => {
      fetchThreadStatus();
      interval = setInterval(fetchThreadStatus, 180000);
    }, 1400);
    return () => {
      clearTimeout(boot);
      if (interval) clearInterval(interval);
    };
  }, []);

  // Fetch material inventory: try status endpoint first, else try GET /materialInventory and derive status
  useEffect(() => {
    const API_ROOT = (process.env.REACT_APP_API_ROOT || '/api').replace(/\/$/, '');
    const fetchMaterialStatus = async () => {
      try {
        const res = await axios.get(`${API_ROOT}/material-inventory-status`, { withCredentials: true });
        if (res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
          setMaterialInventoryStatus(res.data);
          return;
        }
      } catch (_) {}
      try {
        const res = await axios.get(`${API_ROOT}/materialInventory`, { withCredentials: true });
        const arr = Array.isArray(res.data) ? res.data : [];
        const map = {};
        arr.forEach(row => {
          const name = (row.materialName ?? row.Material ?? row.name ?? row.value ?? '').toString().trim();
          if (!name) return;
          const inv = Number(row.inventory ?? row.Quantity ?? row.quantity ?? row.Stock ?? 0);
          const onOrder = Number(row.onOrder ?? row['Inventory..'] ?? row.inventoryOnOrder ?? 0);
          if (inv < 0 && onOrder > 0) map[name] = 'yellow';
          else if (inv < 0) map[name] = 'red';
          else map[name] = 'green';
        });
        setMaterialInventoryStatus(map);
      } catch (_) {}
    };
    let interval = null;
    const boot = setTimeout(() => {
      fetchMaterialStatus();
      interval = setInterval(fetchMaterialStatus, 180000);
    }, 2800);
    return () => {
      clearTimeout(boot);
      if (interval) clearInterval(interval);
    };
  }, []);

  // Helper: get thread status (red | yellow | green). Supports API returning string or object with inventory/onOrder.
  const getThreadStatus = (threadCode) => {
    const raw = threadInventoryStatus[threadCode];
    if (raw === undefined || raw === null) return 'green';
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object' && raw !== null) {
      const inv = raw.inventory ?? raw.quantity ?? raw.Inventory ?? 0;
      const onOrder = raw.onOrder ?? raw.inventoryOnOrder ?? raw['Inventory..'] ?? 0;
      const numInv = Number(inv);
      const numOn = Number(onOrder);
      if (numInv < 0 && numOn > 0) return 'yellow';
      if (numInv < 0) return 'red';
      return 'green';
    }
    return 'green';
  };

  // Helper: get material status (red = negative, yellow = on order, green = in stock). Unknown => green (no data = assume OK).
  const getMaterialStatus = (materialName) => {
    if (!materialName || !String(materialName).trim()) return 'green';
    const key = String(materialName).trim();
    const lower = key.toLowerCase();
    const status = materialInventoryStatus[key] ?? Object.entries(materialInventoryStatus).find(([k]) => k.trim().toLowerCase() === lower)?.[1];
    return status ?? 'green';
  };

  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif', fontSize: 13 }}>
      {/* Top‐line controls + status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        marginBottom: 12
      }}>
        <button
          onClick={() => setShowModal?.(true)}
          style={{ fontSize: 13 }}
        >
          + Add Placeholder
        </button>

        <button onClick={() => handleSync?.()} style={{ fontSize: 13 }}>
          Sync from Sheet{' '}
          {syncStatus === 'updated' && <span style={{ color: 'green' }}>✓ Updated</span>}
        </button>

        <button 
          onClick={props.handleAutoFill} 
          style={{ fontSize: 13, background: '#e3f2fd', border: '1px solid #2196f3' }}
          title="Auto-fill machines to 10 jobs (machines with 6+ heads only)"
        >
          Auto-Fill to 10
        </button>

        {/* push status to the far right */}
        <span style={{ marginLeft: 'auto', fontWeight: 'bold' }}>
          {status}
        </span>
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          margin: '12px 0',
          flexWrap: 'wrap',
          fontSize: 12
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: LIGHT_YELLOW,
              border: `2px solid ${DARK_YELLOW}`,
              borderRadius: 2
            }}
          />
          Placeholder
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: LIGHT_ORANGE,
              border: `2px solid ${DARK_ORANGE}`,
              borderRadius: 2
            }}
          />
          Sample (qty 1)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: LIGHT_BLUE,
              border: `2px solid ${DARK_BLUE}`,
              borderRadius: 2
            }}
          />
          Shopify
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: LIGHT_GREY,
              border: `2px solid ${DARK_GREY}`,
              borderRadius: 2
            }}
          />
          Soft Date
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: LIGHT_PURPLE,
              border: `2px solid ${DARK_PURPLE}`,
              borderRadius: 2
            }}
          />
          Hard Date
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background:
                'repeating-linear-gradient(45deg, rgba(255,0,0,0.5) 0, rgba(255,0,0,0.5) 6px, transparent 6px, transparent 12px)',
              border: '2px solid red',
              borderRadius: 2
            }}
          />
          Late
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 14 }}>🔗</span> Link
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 14 }}>❌</span> Unlink
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: BUBBLE_START,
              borderRadius: 2
            }}
          />{' '}
          Start
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: BUBBLE_END,
              borderRadius: 2
            }}
          />{' '}
          EED / End
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: BUBBLE_DELIV,
              borderRadius: 2
            }}
          />{' '}
          IHD / Delivery
        </div>
      </div>

       <DragDropContext
         onDragEnd={result => {
           setStatus('Working…');
           const onDragEndFn = props.onDragEnd;
           if (typeof onDragEndFn !== 'function') {
             setStatus('');
             return;
           }
           const ret = onDragEndFn(result);
           if (ret && typeof ret.then === 'function') {
             ret
               .then(() => setStatus('Success!'))
               .catch(() => setStatus('Error'));
           } else {
             setStatus('Success!');
           }
         }}
       >
        <div style={{ display: 'flex', gap: 16, marginTop: 16, overflowX: 'auto' }}>
          {['queue', 'machine1', 'machine2'].map(colId => {
            const col = safeColumns[colId] || {};
            const rawJobs = Array.isArray(col.jobs) ? col.jobs : [];
            const jobs = rawJobs
              // keep only active jobs
              .filter(j => {
                if (!j || j.id === undefined) return false;
                const st = String(j.status).trim().toLowerCase();
                return st !== 'complete' && st !== 'sewing';
              })
              // 🚫 drop towels (case-insensitive; supports job.product or job.Product)
              .filter(j => {
                const prod = String(j.product ?? j.Product ?? '').toLowerCase();
                return !prod.includes('towel');
              });

            const segments = [];
            let idx = 0;
            const getChainSafe = typeof getChain === 'function' ? getChain : () => [];
            while (idx < jobs.length) {
              const chainIds = getChainSafe(jobs, jobs[idx].id);
              const len = chainIds.length > 1 ? chainIds.length : 1;
              segments.push({ start: idx, len });
              idx += len;
            }

            return (
              <Droppable key={colId} droppableId={colId}>
                {provided => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{
                      position: 'relative',
                      border: '1px solid #ccc',
                      borderRadius: 4,
                      width: colId === 'queue' ? 300 : 380,
                      minHeight: 400,
                      padding: 12,
                      background: '#fafafa'
                    }}
                  >
                    <h4 style={{ textAlign: 'center', margin: '8px 0', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent:                                                             'center', gap: 6 }}>
                      {col.title}
                      {colId !== 'queue' && (
                        <span
                          style={{
                            display:        'inline-flex',
                            alignItems:     'center',
                            justifyContent: 'center',
                            width:          24,
                            height:         24,
                            borderRadius:   '50%',
                            backgroundColor:'#000',
                            color:          '#fff',
                            fontSize:       12,
                            fontWeight:     'bold'
                          }}
                        >
                          {safeColumns[colId]?.headCount ?? 0}
                        </span>
                      )}
                    </h4>

                    {segments.map((seg, sIdx) => (
                      <div
                        key={sIdx}
                        style={{
                          position: 'relative',
                          marginBottom: 6,
                          zIndex: seg.len > 1 ? 3 : 1,
                          outline: seg.len > 1 ? `6px solid #0288d1` : undefined,
                          borderRadius: 4
                        }}
                      >
                        {jobs
                          .slice(seg.start, seg.start + seg.len)
                          .map((job, jIdx) => {
                            const globalIdx = seg.start + jIdx;
                            const isPh = String(job.id).startsWith('ph-');
                            // for placeholders we need a bit more room
                            const stripWidth = isPh ? 36 : 24;
                            const rightPadding = stripWidth + 8;
                            const isHard = job.due_type === 'Hard Date';
                            const isSoft = !isPh && !isHard;
                            const isSample = !isPh && Number(job.quantity) === 1;
                            const isShopify =
                              !isPh &&
                              String(job.company ?? '')
                                .trim()
                                .toLowerCase() === 'shopify';

                            const base = isPh
                              ? LIGHT_YELLOW
                              : isShopify
                              ? LIGHT_BLUE
                              : isSample
                              ? LIGHT_ORANGE
                              : isSoft
                              ? LIGHT_GREY
                              : LIGHT_PURPLE;
                            const bCol = isPh
                              ? DARK_YELLOW
                              : isShopify
                              ? DARK_BLUE
                              : isSample
                              ? DARK_ORANGE
                              : isSoft
                              ? DARK_GREY
                              : DARK_PURPLE;

                            return (
                              <Draggable
                                key={job.id.toString()}
                                draggableId={job.id.toString()}
                                index={globalIdx}
                              >
                                {prov => (
                                  <div
                                    ref={prov.innerRef}
                                    {...prov.draggableProps}
                                    {...prov.dragHandleProps}
                                    style={{
                                      position: 'relative',
                                      display: 'grid',
                                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                                      gridTemplateRows: 'repeat(4, auto)',
                                      columnGap: 6,
                                      rowGap: 4,
                                      // give room for a 56px thumb + 8px gap on the left when artwork exists
                                      paddingTop: 6,
                                      paddingBottom: 6,
                                      paddingRight: rightPadding,
                                      paddingLeft: job.imageLink ? 6 + 56 + 8 : 6,
                                      margin: `0 0 ${jIdx < seg.len - 1 ? 6 : 0}px 0`,
                                      background: job.isLate
                                        ? 'repeating-linear-gradient(45deg, rgba(255,0,0,0.5) 0, rgba(255,0,0,0.5) 6px, transparent 6px, transparent 12px)'
                                        : base,
                                      border: `2px solid ${job.isLate ? 'red' : bCol}`,
                                      borderRadius: 4,
                                      zIndex: 2,
                                      ...prov.draggableProps.style
                                    }}

                                  >
{/* Artwork thumbnail (absolute, top-left); hidden if no imageLink. When digitized, show checkmark under image and thread colors in white boxes. */}
{job.imageLink ? (
  <div
    style={{
      position: 'absolute',
      top: 6,
      left: 6,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      zIndex: 5,
      gap: 4
    }}
  >
    <div
      title="Click to open full artwork"
      style={{
        display: 'block',
        width: 56,
        height: 56,
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid #eee',
        background: '#fff',
        cursor: 'pointer'
      }}
      onMouseDown={(e) => { e.stopPropagation(); }}
      onClick={(e) => {
        e.stopPropagation();
        openArtwork(job.imageLink); // full file via backend proxy (thumb=0)
      }}
    >
      {(() => {
        // 1) Build a safe thumbnail src
        let src = toPreviewUrl(job.imageLink); // usually /drive/proxy/<id>?thumb=1&sz=w240

        if (!src) {
          // Parse Google Drive id if toPreviewUrl couldn't
          try {
            const m = (job.imageLink || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/);
            const altId = m ? m[1] : new URL(job.imageLink).searchParams.get('id');
            if (altId) src = `${(process.env.REACT_APP_API_ROOT || '/api').replace(/\/$/, '')}/drive/proxy/${altId}?thumb=1&sz=w240`;
          } catch {}
        }

        // 2) If still nothing, render a label (no white boxes)
        if (!src) {
          return (
            <span style={{ fontSize: 11, color: '#888', padding: 4, display: 'block', textAlign: 'center' }}>
              No image
            </span>
          );
        }

        // 3) Prioritize first 8 rows
        const isAboveFold = typeof globalIdx === 'number' ? globalIdx < 8 : false;

        return (
          <img
            src={src}
            alt={`${(job.product ?? job.Product ?? 'Artwork')} preview`}
            width={56}
            height={56}
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
            loading={isAboveFold ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={isAboveFold ? 'high' : 'low'}
            data-upscaled="0"
            onLoad={(e) => {
              // If Drive thumb came back tiny (like 1x1), retry once with a bigger thumbnail (w512)
              const img = e.currentTarget;
              if (img.dataset.upscaled === '1') return;
              if (img.naturalWidth <= 2 || img.naturalHeight <= 2) {
                try {
                  const m = (job.imageLink || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/);
                  const id = m ? m[1] : new URL(job.imageLink).searchParams.get('id');
                  if (id) {
                    img.dataset.upscaled = '1';
                    img.src = `${(process.env.REACT_APP_API_ROOT || '/api').replace(/\/$/, '')}/drive/proxy/${id}?thumb=1&sz=w512`;
                  }
                } catch {}
              }
            }}
            onError={(e) => {
              // If the smaller thumb failed, try once more with a bigger thumb
              const img = e.currentTarget;
              if (img.dataset.upscaled === '1') return;
              try {
                const m = (job.imageLink || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/);
                const id = m ? m[1] : new URL(job.imageLink).searchParams.get('id');
                if (id) {
                  img.dataset.upscaled = '1';
                  img.src = `${(process.env.REACT_APP_API_ROOT || '/api').replace(/\/$/, '')}/drive/proxy/${id}?thumb=1&sz=w512`;
                }
              } catch {}
            }}
          />
        );
      })()}
    </div>
    {/* D/T/M status or green checkmark when all three ready (D=Digitized, T=Thread, M=Material). No sticky green. */}
    {!isPh && (() => {
      const isDigitized = !!(job.threadColors != null && String(job.threadColors).trim());
      const dStatus = isDigitized ? 'green' : 'red';
      const threadCodes = (job.threadColors != null && String(job.threadColors).trim())
        ? String(job.threadColors).split(',').map(c => c.trim()).filter(Boolean)
        : [];
      let tStatus = 'gray';
      if (threadCodes.length) {
        const statuses = threadCodes.map(c => getThreadStatus(c));
        if (statuses.some(s => s === 'red')) tStatus = 'red';
        else if (statuses.some(s => s === 'yellow')) tStatus = 'yellow';
        else tStatus = 'green';
      }
      const materials = Array.isArray(job.materials) ? job.materials : [];
      let mStatus = 'green';
      if (materials.length) {
        const statuses = materials.map(m => getMaterialStatus(m));
        if (statuses.some(s => s === 'red')) mStatus = 'red';
        else if (statuses.some(s => s === 'yellow')) mStatus = 'yellow';
      }
      // At Cut or Embroidery, treat material as OK for this card (inventory yellow/red is sheet-wide).
      const jobStage = String(job.Stage ?? job.stage ?? job.status ?? job.Status ?? '').trim().toLowerCase();
      if (jobStage === 'cut' || jobStage === 'embroidery') {
        mStatus = 'green';
      }
      const allGreen = dStatus === 'green' && tStatus === 'green' && mStatus === 'green';
      const letterStyle = (color) => {
        if (color === 'gray') {
          return {
            width: 14, height: 14, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 'bold', flexShrink: 0,
            background: '#e0e0e0', color: '#9e9e9e', border: '1px solid #bdbdbd'
          };
        }
        return {
          width: 14, height: 14, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 'bold', flexShrink: 0,
          background: color === 'green' ? '#b8e6b8' : color === 'yellow' ? '#ffecb3' : '#ffcdd2',
          color: color === 'green' ? '#1b5e20' : color === 'yellow' ? '#333' : '#b71c1c',
          border: `1px solid ${color === 'green' ? '#2e7d32' : color === 'yellow' ? '#f9a825' : '#c62828'}`
        };
      };
      if (allGreen) {
        return (
          <div title="Digitized, thread & material ready" style={{ width: 18, height: 18, borderRadius: '50%', background: '#b8e6b8', border: '1px solid #2e7d32', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none" style={{ display: 'block' }}>
              <path d="M1 4 L4 7 L9 1" stroke="#1b5e20" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} title="D=Digitized, T=Thread, M=Material">
          <span style={letterStyle(dStatus)} title="Digitized">D</span>
          <span style={letterStyle(tStatus)} title="Thread">T</span>
          <span style={letterStyle(mStatus)} title="Material">M</span>
        </div>
      );
    })()}
  </div>
) : null}



{/* only show badge outside strip on real jobs */}
{!isPh && (
  <span
    style={{
      position: 'absolute',
      top: 4,
      right: 4,
      width: 16,
      height: 16,
      background: base,
      border: `1px solid ${bCol}`,
      borderRadius: 2,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 10,
      fontWeight: 'bold',
      zIndex: 7
    }}
  >
    {job.due_type === 'Hard Date' ? 'H' : 'S'}
  </span>
)}

{/* unified action strip: badge+edit+delete+link, evenly spaced for placeholders */}
<div
  style={{
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: stripWidth,
    background: base,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: isPh ? 'space-evenly' : 'center',
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    zIndex: 6,
    overflow: 'hidden',
  }}
>
  {/* placeholder’s own badge */}
  {isPh && (
    <span
      style={{
        width: 16,
        height: 16,
        background: base,
        border: `1px solid ${bCol}`,
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 'bold'
      }}
    >
      {job.due_type === 'Hard Date' ? 'H' : 'S'}
    </span>
  )}

  {/* edit ✎ */}
  {isPh && (
    <span
      onClick={e => { e.stopPropagation(); editPlaceholder(job); }}
      style={{ cursor: 'pointer', fontSize: 14 }}
    >
      ✎
    </span>
  )}

  {/* delete ✖ */}
  {isPh && (
    <span
      onClick={e => { e.stopPropagation(); removePlaceholder(job.id); }}
      style={{ cursor: 'pointer', fontSize: 14 }}
    >
      ✖
    </span>
  )}

  {/* link/unlink 🔗/❌ */}
  {globalIdx < jobs.length - 1 && (
    <span
      onClick={() => toggleLink(colId, globalIdx)}
      style={{ cursor: 'pointer', fontSize: 16 }}
    >
      {job.linkedTo === jobs[globalIdx + 1]?.id ? '❌' : '🔗'}
    </span>
  )}
</div>

                                    {/* Job ID + Company */}
                                    {/* Row 1: Company–Product (fills) + Quantity (right) */}
                                    <div
                                      style={{
                                        gridRow: 1,
                                        gridColumn: '1 / span 2',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        minWidth: 0
                                      }}
                                    >
                                      {/* ID dot */}
                                      <span
                                        style={{
                                          flexShrink: 0,
                                          display: 'inline-block',
                                          width: 20,
                                          height: 20,
                                          borderRadius: '50%',
                                          background: '#000',
                                          color: base,
                                          lineHeight: '20px',
                                          textAlign: 'center',
                                          fontSize: isPh ? 13 : 11,
                                          fontWeight: 'bold',
                                          marginRight: 4
                                        }}
                                      >
                                        {isPh ? '*' : job.id}
                                      </span>

                                      {/* Company – Product bubble (expands fully until Quantity) */}
                                      <span
                                        style={{
                                          flexGrow: 1,
                                          minWidth: 0,
                                          background: base,
                                          padding: '0 4px',
                                          borderRadius: 4,
                                          whiteSpace: 'nowrap',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          fontSize: 13,
                                          fontWeight: 'bold'
                                        }}
                                      >
                                        {job.company}{(job.product ?? job.Product) ? ' - ' : ''}{job.product ?? job.Product ?? ''}
                                      </span>

                                      {/* Quantity bubble pinned right */}
                                      <span
                                        style={{
                                          marginLeft: 6,
                                          background: base,
                                          padding: '0 4px',
                                          borderRadius: 4,
                                          fontSize: 15,
                                          fontWeight: 'bold',
                                          whiteSpace: 'nowrap'
                                        }}
                                      >
                                        {job.quantity}
                                      </span>
                                    </div>

                                    {/* Embroidery Start */}
                                    {job.start && (
                                      <span
                                        style={{
                                          gridRow: 2,
                                          gridColumn: 2,
                                          justifySelf: 'end',
                                          background: BUBBLE_START,
                                          padding: '0 4px',
                                          borderRadius: 10,
                                          whiteSpace: 'nowrap',
                                          fontSize: 13
                                        }}
                                      >
                                        {job.start}
                                      </span>
                                    )}

                                    {/* EED */}
                                    <span
                                      style={{
                                        gridRow: 2,
                                        gridColumn: 1,
                                        background: BUBBLE_END,
                                        padding: '0 4px',
                                        borderRadius: 4,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        fontSize: 13
                                      }}
                                    >
                                      EED: {fmtMMDD(subWorkDays(parseDueDate(job.due_date), 6))}
                                    </span>

                                    {/* Embroidery End */}
                                    {job.end && (
                                      <span
                                        style={{
                                          gridRow: 3,
                                          gridColumn: 2,
                                          justifySelf: 'end',
                                          background: BUBBLE_END,
                                          padding: '0 4px',
                                          borderRadius: 10,
                                          whiteSpace: 'nowrap',
                                          fontSize: 13
                                        }}
                                      >
                                        {job.end}
                                      </span>
                                    )}

                                    {/* Delivery */}
                                    <span
                                      style={{
                                        gridRow: 3,
                                        gridColumn: 1,
                                        background: BUBBLE_DELIV,
                                        padding: '0 4px',
                                        borderRadius: 4,
                                        whiteSpace: 'nowrap',
                                        fontSize: 13
                                      }}
                                    >
                                      IHD: {fmtMMDD(job.due_date)}
                                    </span>
                                    {job.delivery && (
                                      <span
                                        style={{
                                          gridRow: 4,
                                          gridColumn: 2,
                                          justifySelf: 'end',
                                          background: BUBBLE_DELIV,
                                          padding: '0 4px',
                                          borderRadius: 10,
                                          whiteSpace: 'nowrap',
                                          fontSize: 13
                                        }}
                                      >
                                        {job.delivery}
                                      </span>
                                    )}

                                    {/* Thread‐Color Bubbles (digitized jobs): solid fill by status — red = missing, yellow = ordered, white = in stock */}
                                    {job.threadColors != null && String(job.threadColors).trim() && (
                                      <div
                                        style={{
                                          gridRow:             4,
                                          gridColumn:          1,
                                          display:             'grid',
                                          gridTemplateColumns: 'repeat(8, 1fr)',   // 8 equal columns
                                          gridTemplateRows:    'repeat(2, auto)',  // max 2 rows
                                          gap:                 2,
                                          marginTop:           4,
                                          overflow:            'hidden',
                                          minWidth:            0                   // ← lets it expand right up to Delivery
                                        }}
                                      >
                                        {String(job.threadColors)
                                          .split(',')
                                          .map(c => c.trim())
                                          .filter(c => c)
                                          .sort((a, b) => Number(a) - Number(b))
                                          .map(code => {
                                            const threadStatus = getThreadStatus(code);
                                            // Solid fill: red = missing, yellow = ordered, default = in stock (white)
                                            const isRed = threadStatus === 'red';
                                            const isYellow = threadStatus === 'yellow';
                                            const backgroundColor = isRed ? '#c62828' : isYellow ? '#ffecb3' : '#fff';
                                            const borderColor = isRed ? '#b71c1c' : isYellow ? '#f9a825' : '#e0e0e0';
                                            const textColor = isRed ? '#fff' : isYellow ? '#333' : '#111';
                                            return (
                                              <span
                                                key={code}
                                                style={{
                                                  background:   backgroundColor,
                                                  color:       textColor,
                                                  border:      `1px solid ${borderColor}`,
                                                  borderRadius: 3,
                                                  padding:     '1px 2px',
                                                  fontSize:    10,
                                                  textAlign:   'center',
                                                  overflow:    'visible',
                                                  textOverflow: 'clip',
                                                  whiteSpace:  'normal',
                                                  width:       '100%'
                                                }}
                                              >
                                                {code}
                                              </span>
                                            );
                                          })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </Draggable>
                            );
                          })}
                      </div>
                    ))}

                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>

      {/* Modal for Add / Edit Placeholder */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: 24,
              borderRadius: 8,
              width: 320,
              boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
            }}
          >
            <h3 style={{ marginTop: 0 }}>Add / Edit Placeholder</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                type="text"
                placeholder="Company"
                value={ph.company}
                onChange={e => setPh(p => ({ ...p, company: e.target.value }))}
                style={{ padding: 8, fontSize: 13, width: '100%' }}
              />
              <input
                type="number"
                placeholder="Quantity"
                value={ph.quantity}
                onChange={e => setPh(p => ({ ...p, quantity: e.target.value }))}
                style={{ padding: 8, fontSize: 13, width: '100%' }}
              />
              <input
                type="number"
                placeholder="Stitch Count"
                value={ph.stitchCount}
                onChange={e => setPh(p => ({ ...p, stitchCount: e.target.value }))}
                style={{ padding: 8, fontSize: 13, width: '100%' }}
              />
              <input
                type="date"
                placeholder="In Hand Date"
                value={ph.inHand}
                onChange={e => setPh(p => ({ ...p, inHand: e.target.value }))}
                style={{ padding: 8, fontSize: 13, width: '100%' }}
              />
              <select
                value={ph.dueType}
                onChange={e => setPh(p => ({ ...p, dueType: e.target.value }))}
                style={{ padding: 8, fontSize: 13, width: '100%' }}
              >
                <option>Hard Date</option>
                <option>Soft Date</option>
              </select>
            </div>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button
                onClick={() => setShowModal(false)}
                style={{ marginRight: 8, fontSize: 13 }}  
              >
                Cancel
              </button>
              <button onClick={submitPlaceholder} style={{ fontSize: 13 }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
