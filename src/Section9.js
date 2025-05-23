// File: frontend/src/Section9.jsx
import React from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { fmtMMDD, subWorkDays, parseDueDate } from './helpers';

export default function Section9(props) {
  console.log('🔥 Section9 props.onDragEnd is', typeof props.onDragEnd);

  const {
    columns,
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
    BUBBLE_DELIV
  } = props;

  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif', fontSize: 13 }}>
      {/* Top controls */}
      <button
        onClick={() => setShowModal(true)}
        style={{ marginRight: 8, fontSize: 13 }}
      >
        + Add Placeholder
      </button>
      <button onClick={handleSync} style={{ fontSize: 13 }}>
        Sync from Sheet{' '}
        {syncStatus === 'updated' && <span style={{ color: 'green' }}>✓ Updated</span>}
      </button>

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
          console.log('🔍 Section9 DRAG-END result:', result);
          if (typeof onDragEnd === 'function') {
            onDragEnd(result);
          }
        }}
      >
        <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
          {['queue', 'machine1', 'machine2'].map(colId => {
            const col = columns[colId] || {};
            const rawJobs = Array.isArray(col.jobs) ? col.jobs : [];
            const jobs = rawJobs.filter(j => j && j.id !== undefined);

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
                      width: colId === 'queue' ? 260 : 300,
                      minHeight: 400,
                      padding: 12,
                      background: '#fafafa'
                    }}
                  >
                    <h4
                      style={{
                        textAlign: 'center',
                        margin: '8px 0',
                        fontSize: 13
                      }}
                    >
                      {col.title}
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
                            const stripWidth = isPh ? 32 : 24;
                            const rightPadding = stripWidth + 4; // extra gutter so icon margins don’t push off;
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
                                      gridTemplateColumns: '1fr auto',
                                      gridTemplateRows: 'repeat(4, auto)',
                                      columnGap: 6,
                                      rowGap: 4,
                                      padding: `6px ${rightPadding}px 6px 6px`,  // keep content clear of strip 
                                      margin: `0 0 ${
                                        jIdx < seg.len - 1 ? 6 : 0
                                      }px 0`,
                                      background: job.isLate
                                        ? 'repeating-linear-gradient(45deg, rgba(255,0,0,0.5) 0, rgba(255,0,0,0.5) 6px, transparent 6px, transparent 12px)'
                                        : base,
                                      border: `2px solid ${
                                        job.isLate ? 'red' : bCol
                                      }`,
                                      borderRadius: 4,
                                      zIndex: 2,
                                      ...prov.draggableProps.style
                                    }}
                                  >
                                    {/* H/S badge (now above the action strip) */}
                                    <span
                                      style={{
                                        position: 'absolute',
                                        top: 4,
                                        right: 4,
                                        zIndex: 7,            // ensure it sits above the strip
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
                                      }}
                                    >
                                      {job.due_type === 'Hard Date'
                                        ? 'H'
                                        : job.due_type === 'Soft Date'
                                        ? 'S'
                                        : ''}
                                    </span>

                                    {/* Unified action strip */}
                                    <div
                                        style={{
                                          position: 'absolute',
                                          top: 0,
                                          bottom: 0,               // span exactly from top→bottom
                                          right: 0,
                                          width: stripWidth,
                                          background: base,
                                          display: 'flex',
                                          flexDirection: 'column',
                                          alignItems: 'center',
                                          justifyContent: isPh ? 'flex-start' : 'center',
                                          paddingTop: isPh ? 4 : 0,
                                          borderTopRightRadius: 4,
                                          borderBottomRightRadius: 4,
                                          zIndex: 6,
                                          overflow: 'hidden',     // never grow beyond card
                                        }}
                                      >
                                        {/* always show ✎ & ✖ for placeholders */}
                                        {isPh && (
                                          <>
                                            <span
                                              onClick={e => { e.stopPropagation(); editPlaceholder(job); }}
                                              style={{ cursor: 'pointer', fontSize: 12, margin: 2 }}
                                            >
                                              ✎
                                            </span>
                                            <span
                                              onClick={e => { e.stopPropagation(); removePlaceholder(job.id); }}
                                              style={{ cursor: 'pointer', fontSize: 12, margin: 2 }}
                                            >
                                              ✖
                                            </span>
                                          </>
                                        )}
                                    
                                        {/* link/unlink under the edit/delete */}
                                        {globalIdx < jobs.length - 1 && (
                                          <span
                                            onClick={() => toggleLink(colId, globalIdx)}
                                            style={{ cursor: 'pointer', fontSize: 14, margin: 2 }}
                                          >
                                            {job.linkedTo === jobs[globalIdx + 1]?.id ? '❌' : '🔗'}
                                          </span>
                                        )}
                                      </div>

                                    {/* Job ID + Company */}
                                    <span
                                      style={{
                                        gridRow: 1,
                                        gridColumn: 1,
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
                                      <span
                                        style={{
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
                                      {job.company}
                                    </span>

                                    {/* Quantity */}
                                    <span
                                      style={{
                                        gridRow: 1,
                                        gridColumn: 2,
                                        justifySelf: 'end',
                                        background: base,
                                        padding: '0 4px',
                                        borderRadius: 4,
                                        fontSize: 15,
                                        fontWeight: 'bold',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                      }}
                                    >
                                      {job.quantity}
                                    </span>

                                    {/* Design */}
                                    <span
                                      style={{
                                        gridRow: 2,
                                        gridColumn: 1,
                                        background: base,
                                        padding: '0 4px',
                                        borderRadius: 4,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        fontSize: 13
                                      }}
                                    >
                                      {job.design?.slice(0, 22)}
                                    </span>

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
                                        gridRow: 3,
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
                                        gridRow: 4,
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
