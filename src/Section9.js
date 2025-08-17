// File: frontend/src/Section9.jsx
import React, { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { fmtMMDD, subWorkDays, parseDueDate } from './helpers';

export default function Section9(props) {
  console.log('🔥 Section9 props.onDragEnd is', typeof props.onDragEnd);

  const [status, setStatus] = useState('');
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
    BUBBLE_START,
    BUBBLE_END,
    BUBBLE_DELIV,
    // ⬇️ NEW: helpers passed from App.js
    toPreviewUrl,
    openArtwork
  } = props;


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
          onClick={() => setShowModal(true)}
          style={{ fontSize: 13 }}
        >
          + Add Placeholder
        </button>

        <button onClick={handleSync} style={{ fontSize: 13 }}>
          Sync from Sheet{' '}
          {syncStatus === 'updated' && <span style={{ color: 'green' }}>✓ Updated</span>}
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
           // show working...
           setStatus('Working…');
 
           // call the passed-in handler (which does your fetch)
           const ret = props.onDragEnd(result);
 
           // if it returns a Promise, wait for it
           if (ret && typeof ret.then === 'function') {
             ret
               .then(() => setStatus('Success!'))
               .catch(() => setStatus('Error'));
           } else {
             // otherwise mark success immediately
             setStatus('Success!');
           }
         }}
       >
        <div style={{ display: 'flex', gap: 16, marginTop: 16, overflowX: 'auto' }}>
          {['queue', 'machine1', 'machine2'].map(colId => {
            const col = columns[colId] || {};
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

            console.log('🤖 Column', colId, 'jobs after filter:', jobs.map(j => [j.id, `"${j.status}"`, (j.product ?? j.Product ?? '')] ));


            const segments = [];
            let idx = 0;
            while (idx < jobs.length) {
              const chainIds = getChain(jobs, jobs[idx].id);
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
                          {columns[colId].headCount}
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

                            const base = isPh
                              ? LIGHT_YELLOW
                              : isSoft
                              ? LIGHT_GREY
                              : LIGHT_PURPLE;
                            const bCol = isPh
                              ? DARK_YELLOW
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
{/* Artwork thumbnail (absolute, top-left); hidden if no imageLink */}
{job.imageLink ? (
  <div
    title="Click to open full artwork"
    style={{
      position: 'absolute',
      top: 6,
      left: 6,
      display: 'block',
      zIndex: 5,
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
      // Use globalIdx if that's your map index; load first 8 eagerly
      const isAboveFold = typeof globalIdx === 'number' ? globalIdx < 8 : false;

      return (
        <img
          src={toPreviewUrl(job.imageLink)}
          alt={`${(job.product ?? job.Product ?? 'Artwork')} preview`}
          width={56}
          height={56}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
          loading={isAboveFold ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={isAboveFold ? 'high' : 'low'}
          onError={(e) => {
            // Fallback: if thumbnail fails, show full file via proxy inline
            try {
              const m = (job.imageLink || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/);
              const id = m ? m[1] : new URL(job.imageLink).searchParams.get('id');
              if (id) e.currentTarget.src = `${process.env.REACT_APP_API_ROOT}/drive/proxy/${id}?thumb=0`;
            } catch (_) { /* no-op */ }
          }}
        />
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

                                    {/* Thread‐Color Bubbles */}

                                    {job.threadColors && (
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
                                        {job.threadColors
                                          .split(',')
                                          .map(c => c.trim())
                                          .filter(c => c)
                                          .sort((a, b) => Number(a) - Number(b))
                                          .map(code => (
                                            <span
                                              key={code}
                                              style={{
                                                background:   '#fff',
                                                color:        '#000',
                                                borderRadius: 3,
                                                padding:      '1px 2px',
                                                fontSize:     10,
                                                textAlign:    'center',
                                                // show full text; allow wrapping if needed
                                                overflow:     'visible',
                                                textOverflow: 'clip',
                                                whiteSpace:   'normal',
                                                width:        '100%'
                                              }}
                                            >
                                              {code}
                                            </span>
                                          ))}
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
