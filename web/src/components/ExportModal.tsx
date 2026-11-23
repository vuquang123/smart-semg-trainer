import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  FolderArchive,
  Info,
  LoaderCircle,
} from 'lucide-react';
import type { RawChunk, SessionRecord } from '../core/protocol';
import { buildExportFilename, buildExportModel } from '../storage/exportModel';
import { buildReportXlsx } from '../storage/xlsxReport';
import { buildReportPdf } from '../storage/pdfReport';
import { buildResearchZip } from '../storage/researchExport';
import { triggerBrowserDownload } from '../storage/export';
import type { Repository } from '../storage/repository';
import { Modal } from './UI';

type Props = {
  record: SessionRecord;
  sessions?: SessionRecord[];
  repository?: Repository;
  mobile: boolean;
  onClose: () => void;
};

type ReportFormat = 'pdf' | 'xlsx';
type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'success'; filename: string; detail: string }
  | { kind: 'error'; message: string };

export function ExportModal({ record, sessions, repository, mobile, onClose }: Props) {
  const availableSessions = useMemo(() => {
    if (!sessions || sessions.length === 0) return [record];
    return sessions.some(s => s.id === record.id) ? sessions : [record, ...sessions];
  }, [record, sessions]);

  const [selectedId, setSelectedId] = useState(record.id);
  useEffect(() => {
    setSelectedId(record.id);
  }, [record.id]);

  const activeRecord = useMemo(
    () => availableSessions.find(s => s.id === selectedId) ?? record,
    [availableSessions, selectedId, record]
  );

  const sessionOptions = useMemo(
    () =>
      availableSessions.map(s => {
        const m = buildExportModel(s);
        return {
          id: s.id,
          label: `${m.startedAtDisplayVi} · ${m.channelMuscleLabelVi} · ${m.sourceLabelVi} (${m.validCount}${m.target !== null ? `/${m.target}` : ''} lần)`,
        };
      }),
    [availableSessions]
  );

  const [reportFormat, setReportFormat] = useState<ReportFormat>('pdf');
  const [includeProcessed, setIncludeProcessed] = useState(true);
  const [status, setStatus] = useState<ExportStatus>({ kind: 'idle' });
  const [storedRawStats, setStoredRawStats] = useState<{
    checked: boolean;
    sampleCount: number;
    fsHz?: number;
    channels?: 1 | 2;
  }>({ checked: false, sampleCount: activeRecord.raw_summary?.sample_count ?? 0 });

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'idle' });
    const summaryCount = activeRecord.raw_summary?.sample_count ?? 0;
    setStoredRawStats({
      checked: !repository,
      sampleCount: summaryCount,
      fsHz: activeRecord.raw_summary?.fs_hz ?? activeRecord.snapshot.fs_hz,
      channels: activeRecord.raw_summary?.channel_count ?? activeRecord.snapshot.channel_count,
    });
    if (!repository) return;
    void repository
      .getRawChunks(activeRecord.id)
      .then((chunks: RawChunk[]) => {
        if (cancelled) return;
        const count = chunks.reduce((acc, c) => acc + c.sample_count, 0);
        setStoredRawStats({
          checked: true,
          sampleCount: count,
          fsHz: chunks[0]?.fs_hz ?? activeRecord.raw_summary?.fs_hz ?? activeRecord.snapshot.fs_hz,
          channels: chunks[0]?.channels ?? activeRecord.raw_summary?.channel_count ?? activeRecord.snapshot.channel_count,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setStoredRawStats(prev => ({ ...prev, checked: true }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeRecord.id, activeRecord.raw_summary?.sample_count, repository]);

  const model = useMemo(() => buildExportModel(activeRecord), [activeRecord]);
  const hasRaw = storedRawStats.sampleCount > 0 || model.rawSummary.available;
  const rawSamplesDisplay = Math.max(storedRawStats.sampleCount, model.rawSummary.sample_count);
  const busy = status.kind === 'busy';

  const handleExportReport = async () => {
    if (busy) return;
    setStatus({
      kind: 'busy',
      label: reportFormat === 'pdf' ? 'Đang tạo báo cáo PDF…' : 'Đang tạo bảng tính Excel (.xlsx)…',
    });
    try {
      const frozenModel = buildExportModel(activeRecord);
      const filename = buildExportFilename(frozenModel, reportFormat);
      if (reportFormat === 'pdf') {
        const bytes = await buildReportPdf(frozenModel);
        triggerBrowserDownload(bytes, filename, 'application/pdf');
      } else {
        const bytes = await buildReportXlsx(frozenModel);
        triggerBrowserDownload(
          bytes,
          filename,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
      }
      setStatus({
        kind: 'success',
        filename,
        detail: reportFormat === 'pdf' ? 'Đã tạo xong báo cáo PDF.' : 'Đã tạo xong file Excel (.xlsx).',
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Không xuất được báo cáo. Vui lòng thử lại.',
      });
    }
  };

  const handleExportResearch = async () => {
    if (busy) return;
    setStatus({
      kind: 'busy',
      label: 'Đang đóng gói dữ liệu nghiên cứu (.zip)…',
    });
    try {
      const frozenModel = buildExportModel(activeRecord);
      const filename = buildExportFilename(frozenModel, 'zip');
      const result = await buildResearchZip(frozenModel, {
        repository,
        includeProcessed: includeProcessed && frozenModel.hasSignalSeries,
      });
      triggerBrowserDownload(result.bytes, filename, 'application/zip');
      const notes: string[] = [];
      if (result.rawIncluded) {
        notes.push(`${result.rawSampleCount.toLocaleString('vi-VN')} mẫu RAW`);
      } else {
        notes.push('không có signal_raw.csv');
      }
      notes.push(`${result.eventCount} sự kiện`);
      if (result.processedIncluded) notes.push('kèm signal_processed.csv');
      setStatus({
        kind: 'success',
        filename,
        detail: `Đã đóng gói ZIP (${notes.join(' · ')}).`,
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Không đóng gói được dữ liệu nghiên cứu. Vui lòng thử lại.',
      });
    }
  };

  return (
    <Modal
      title="Xuất dữ liệu"
      wide
      variant={mobile ? 'sheet' : 'modal'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="export-modal-body">
        {availableSessions.length > 1 && (
          <div className="export-session-picker">
            <label className="field-label" htmlFor="export-session-select">Chọn buổi tập cần xuất</label>
            <select
              id="export-session-select"
              value={activeRecord.id}
              disabled={busy}
              onChange={e => setSelectedId(e.target.value)}
            >
              {sessionOptions.map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="export-context-bar" aria-label="Thông tin phiên đang xuất">
          <div className="export-context-main">
            <strong>{model.channelMuscleLabelVi}</strong>
            <span>
              {model.startedAtDisplayVi} · Thời lượng {model.durationDisplay} · {model.modeLabelVi}
            </span>
          </div>
          <div className="export-context-badges">
            <span className={`badge ${model.isSynthetic ? 'simulation' : 'status-live'}`}>
              {model.isSynthetic && <FlaskConical size={12} />}
              {model.sourceLabelVi}
            </span>
            <span className="badge neutral">{model.sessionStateLabelVi}</span>
          </div>
        </div>

        {model.isInProgress && (
          <div className="alert neutral export-compact-alert" role="status">
            <Info size={16} />
            <span>
              <strong>Phiên chưa kết thúc:</strong> file xuất ra sử dụng bản chụp dữ liệu nhất quán tại thời điểm hiện tại.
            </span>
          </div>
        )}

        <div className="export-cards-grid">
          {/* Card 1: Báo cáo buổi tập */}
          <section className="export-option-card" aria-label="Báo cáo buổi tập">
            <div className="export-card-head">
              <span className="export-card-icon report">
                {reportFormat === 'pdf' ? <FileText size={20} /> : <FileSpreadsheet size={20} />}
              </span>
              <div>
                <h3>Báo cáo buổi tập</h3>
                <p>Xem kết quả, số lần co cơ và mức hoàn thành mục tiêu.</p>
              </div>
            </div>

            <div className="export-format-group">
              <span className="field-label">Chọn định dạng báo cáo</span>
              <div className="segmented" role="group" aria-label="Định dạng báo cáo buổi tập">
                <button
                  type="button"
                  aria-pressed={reportFormat === 'pdf'}
                  disabled={busy}
                  onClick={() => setReportFormat('pdf')}
                >
                  <FileText size={15} />PDF (.pdf)
                </button>
                <button
                  type="button"
                  aria-pressed={reportFormat === 'xlsx'}
                  disabled={busy}
                  onClick={() => setReportFormat('xlsx')}
                >
                  <FileSpreadsheet size={15} />Excel (.xlsx)
                </button>
              </div>
            </div>

            <div className="export-card-details">
              <span>
                {reportFormat === 'pdf'
                  ? 'Bố cục rõ ràng trên A4 tiếng Việt, kèm biểu đồ RMS và bảng từng lần co cơ.'
                  : 'File Excel (.xlsx) gồm các sheet Tổng kết, Từng lần co cơ và Dữ liệu biểu đồ.'}
              </span>
              {model.missingDataNotes.length > 0 && (
                <div className="export-inline-note">
                  <Info size={14} />
                  <span>{model.missingDataNotes[0]}</span>
                </div>
              )}
            </div>

            <button
              type="button"
              className="button primary full-width"
              disabled={busy}
              onClick={() => void handleExportReport()}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowDownToLine size={16} />}
              <span>{reportFormat === 'pdf' ? 'Tải báo cáo PDF' : 'Tải bảng Excel (.xlsx)'}</span>
            </button>
          </section>

          {/* Card 2: Dữ liệu nghiên cứu — RAW */}
          <section className="export-option-card" aria-label="Dữ liệu nghiên cứu — RAW">
            <div className="export-card-head">
              <span className="export-card-icon research">
                <FolderArchive size={20} />
              </span>
              <div>
                <h3>Dữ liệu nghiên cứu — RAW</h3>
                <p>Tải tín hiệu gốc, thông số thu và sự kiện để phân tích bằng MATLAB/Python.</p>
              </div>
            </div>

            <div className="export-zip-meta">
              <span className="badge neutral">Định dạng: ZIP</span>
              {hasRaw ? (
                <span className="badge status-live">
                  RAW: {rawSamplesDisplay.toLocaleString('vi-VN')} mẫu
                  {storedRawStats.fsHz ? ` · ${storedRawStats.fsHz} Hz` : ''} · Kênh CH1
                </span>
              ) : (
                <span className="badge simulation">Không có dữ liệu RAW</span>
              )}
            </div>

            <div className="export-card-details">
              {hasRaw ? (
                <span>
                  Gói gồm <code>signal_raw.csv</code>, <code>events.csv</code>, <code>metadata.json</code> và{' '}
                  <code>README.txt</code>.
                  {model.rawSummary.missing_samples_detected > 0
                    ? ` Ghi nhận thiếu ${model.rawSummary.missing_samples_detected} mẫu theo chỉ số nguồn.`
                    : ''}
                </span>
              ) : (
                <div className="export-inline-warn">
                  <AlertTriangle size={14} />
                  <span>
                    {model.rawSummary.unavailable_reason ??
                      'Phiên này chưa ghi dữ liệu RAW gốc.'}{' '}
                    Vẫn có thể xuất các file còn lại (<code>events.csv</code>, <code>metadata.json</code>,{' '}
                    <code>README.txt</code>
                    {model.hasSignalSeries ? ', signal_processed.csv' : ''}).
                  </span>
                </div>
              )}

              {model.hasSignalSeries && (
                <label className="export-checkbox-row">
                  <input
                    type="checkbox"
                    checked={includeProcessed}
                    disabled={busy}
                    onChange={e => setIncludeProcessed(e.target.checked)}
                  />
                  <span>Kèm dữ liệu đã xử lý (<code>signal_processed.csv</code>)</span>
                </label>
              )}
            </div>

            <button
              type="button"
              className="button outline full-width"
              disabled={busy}
              onClick={() => void handleExportResearch()}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <FolderArchive size={16} />}
              <span>{hasRaw ? 'Tải gói nghiên cứu (.zip)' : 'Tải dữ liệu hiện có (.zip)'}</span>
            </button>
          </section>
        </div>

        {status.kind === 'busy' && (
          <div className="export-status-banner busy" role="status">
            <LoaderCircle size={17} className="spin" />
            <span>{status.label}</span>
          </div>
        )}
        {status.kind === 'success' && (
          <div className="export-status-banner success" role="status">
            <CheckCircle2 size={17} />
            <span>
              {status.detail} Tên file: <strong>{status.filename}</strong>
            </span>
          </div>
        )}
        {status.kind === 'error' && (
          <div className="export-status-banner error" role="alert">
            <AlertTriangle size={17} />
            <span>{status.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
