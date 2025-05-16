// File: frontend/src/Section9.jsx

// === Section 1: Imports & Styles ===
import React from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { fmtMMDD, subWorkDays, parseDueDate } from './helpers';
import './Section9.css';

// === Section 2: Component ===
export default function Section9(props) {
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
    LIGHT_GREY,
    DARK_YELLOW,
    DARK_GREY,
    LIGHT_PURPLE,
    DARK_PURPLE,
    BUBBLE_START,
    BUBBLE_END,
    BUBBLE_DELIV
  } = props;

  // Legend component
  const Legend = () => (
    <div className="legend">
      {[ 
        { color: LIGHT_YELLOW, border: DARK_YELLOW, label: 'Placeholder' },
        { color: LIGHT_GREY,   border: DARK_GREY,   label: 'Soft Date' },
        { color: LIGHT_PURPLE, border: DARK_PURPLE, label: 'Hard Date' },
        { color: 'red-stripes', border: 'red',       label: 'Late' }
      ].map((leg, i) => (
        <div key={i} className="legend-item">
          <span
            className="legend-box"
            style={{ background: leg.color, borderColor: leg.border }}
          />{' '}
          {leg.label}
        </div>
      ))}
      <div className="legend-item">
        <span className="legend-icon">🔗</span> Link
      </div>
      <div className="legend-item">
        <span className="legend-icon">❌</span> Unlink
      </div>
      {[ 
        { color: BUBBLE_START, label: 'Start' },
        { color: BUBBLE_END,   label: 'EED / End' },
        { color: BUBBLE_DELIV, label: 'IHD / Delivery' }
      ].map((leg, i) => (
        <div key={i} className="legend-item">
          <span
            className="legend-box circle"
            style={{ background: leg.color }}
          />{' '}
          {leg.label}
        </div>
      ))}
    </div>
  );

  return (
    <div className="section9-container">
      {/* Controls */}
      <div className="controls">
        <button onClick={() => setShowModal(true)}>+ Add Placeholder</button>
        <button onClick={handleSync}>
          Sync from Sheet {syncStatus === 'updated' && '✓'}
        </button>
      </div>
      <Legend />

      {/* Drag and Drop Queues */}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="queues">
          {['queue','machine1','machine2'].map(colId => {
            const col     = columns[colId] || { jobs: [] };
            const rawJobs = Array.isArray(col.jobs) ? col.jobs : [];
            const jobs    = rawJobs.filter(j => j && j.id != null);

            // Build chained segments
            const segments = [];
            let idx = 0;
            while (idx < jobs.length) {
              const chain = getChain(jobs, jobs[idx].id);
              const len   = chain.length > 1 ? chain.length : 1;
              segments.push({ start: idx, len });
              idx += len;
            }

            return (
              <Droppable key={colId} droppableId={colId}>
                {provided => (
                  <div
                    className="column"
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                  >
                    <h4>{col.title}</h4>

                    {segments.map((seg, sIdx) => (
                      <div
                        key={sIdx}
                        className={seg.len > 1 ? 'chain-seg linked' : 'chain-seg'}
                      >
                        {jobs
                          .slice(seg.start, seg.start + seg.len)
                          .map((job, jIdx) => {
                            const globalIdx = seg.start + jIdx;
                            const isPh = String(job.id).startsWith('ph-');
                            const dueClass =
                              job.due_type === 'Hard Date' ? 'hard' : 'soft';
                            const base = isPh
                              ? LIGHT_YELLOW
                              : job.due_type === 'Soft Date'
                              ? LIGHT_GREY
                              : LIGHT_PURPLE;
                            const bCol = isPh
                              ? DARK_YELLOW
                              : job.due_type === 'Soft Date'
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
                                    className={`job-card ${dueClass}`}
                                    style={prov.draggableProps.style}
                                  >
                                    {/* Badge H/S */}
                                    {/* injected via CSS */}

                                    {/* Company + ID */}
                                    <div className="job-content">
                                      <span className="job-id">
                                        {isPh ? '*' : job.id}
                                      </span>
                                      <span className="job-company">
                                        {job.company}
                                      </span>
                                    </div>

                                    {/* Bubbles */}
                                    <div className="job-bubbles">
                                      {job.start && (
                                        <span className="bubble start">
                                          {job.start}
                                        </span>
                                      )}
                                      <span className="bubble eed">
                                        EED:{' '}
                                        {fmtMMDD(
                                          subWorkDays(
                                            parseDueDate(job.due_date),
                                            6
                                          )
                                        )}
                                      </span>
                                      <span className="bubble ihd">
                                        IHD: {fmtMMDD(job.due_date)}
                                      </span>
                                    </div>

                                    {/* Link toggle */}
                                    {globalIdx < jobs.length - 1 && (
                                      <div
                                        className="link-toggle"
                                        onClick={() =>
                                          toggleLink(colId, globalIdx)
                                        }
                                      >
                                        {job.linkedTo ===
                                        jobs[globalIdx + 1]?.id
                                          ? '❌'
                                          : '🔗'}
                                      </div>
                                    )}

                                    {/* Placeholder edit/delete */}
                                    {isPh && (
                                      <div className="ph-controls">
                                        <span
                                          onClick={() => editPlaceholder(job)}
                                        >
                                          ✎
                                        </span>
                                        <span
                                          onClick={() =>
                                            removePlaceholder(job.id)
                                          }
                                        >
                                          ✖
                                        </span>
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

      {/* Placeholder Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Add / Edit Placeholder</h3>
            <div className="modal-fields">
              <input
                type="text"
                placeholder="Company"
                value={ph.company}
                onChange={e => setPh(p => ({ ...p, company: e.target.value }))}
              />
              <input
                type="number"
                placeholder="Quantity"
                value={ph.quantity}
                onChange={e =>
                  setPh(p => ({ ...p, quantity: e.target.value }))
                }
              />
              <input
                type="number"
                placeholder="Stitch Count"
                value={ph.stitchCount}
                onChange={e =>
                  setPh(p => ({ ...p, stitchCount: e.target.value }))
                }
              />
              <input
                type="date"
                placeholder="In Hand Date"
                value={ph.inHand}
                onChange={e =>
                  setPh(p => ({ ...p, inHand: e.target.value }))
                }
              />
              <select
                value={ph.due_type}
                onChange={e =>
                  setPh(p => ({ ...p, due_type: e.target.value }))
                }
              >
                <option value="Hard Date">Hard Date</option>
                <option value="Soft Date">Soft Date</option>
              </select>
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowModal(false)}>Cancel</button>
              <button onClick={submitPlaceholder}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
