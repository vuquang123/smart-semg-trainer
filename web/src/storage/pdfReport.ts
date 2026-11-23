import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ExportSessionModel } from './exportModel';

export type PdfReportFonts = {
  regular: Uint8Array;
  bold: Uint8Array;
};

let cachedBrowserFonts: PdfReportFonts | null = null;

async function loadBrowserFonts(): Promise<PdfReportFonts> {
  if (cachedBrowserFonts) return cachedBrowserFonts;
  const [regRes, boldRes] = await Promise.all([
    fetch('/fonts/DejaVuSans.ttf'),
    fetch('/fonts/DejaVuSans-Bold.ttf'),
  ]);
  if (!regRes.ok || !boldRes.ok) {
    throw new Error('Không tải được font tiếng Việt để tạo PDF.');
  }
  const [regBuf, boldBuf] = await Promise.all([regRes.arrayBuffer(), boldRes.arrayBuffer()]);
  cachedBrowserFonts = {
    regular: new Uint8Array(regBuf),
    bold: new Uint8Array(boldBuf),
  };
  return cachedBrowserFonts;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 40;
const TOP_Y = PAGE_H - 42;
const BOTTOM_Y = 48;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const C_PRIMARY = rgb(0.157, 0.455, 0.357); // #28745b
const C_PRIMARY_DARK = rgb(0.122, 0.369, 0.286); // #1f5e49
const C_PRIMARY_BG = rgb(0.918, 0.945, 0.902); // #eaf1e6
const C_TEXT = rgb(0.149, 0.243, 0.208); // #263e35
const C_MUTED = rgb(0.45, 0.51, 0.47);
const C_BORDER = rgb(0.84, 0.88, 0.83);
const C_ROW_ALT = rgb(0.973, 0.984, 0.965);
const C_AMBER = rgb(0.675, 0.482, 0.169); // #ac7b2b
const C_AMBER_BG = rgb(0.988, 0.965, 0.91);
const C_RED = rgb(0.702, 0.278, 0.263); // #b34743
const C_RED_BG = rgb(0.985, 0.933, 0.925);
const C_BLUE = rgb(0.21, 0.41, 0.58);
const C_BLUE_BG = rgb(0.93, 0.96, 0.985);
const C_SLATE = rgb(0.55, 0.61, 0.58);
const C_SLATE_BG = rgb(0.94, 0.955, 0.945);
const C_WHITE = rgb(1, 1, 1);

function cleanPdfText(input: string): string {
  return input.replace(/\r?\n/g, ' ').replace(/\t/g, ' ').trim();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = cleanPdfText(text);
  if (!safe) return [''];
  const words = safe.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  const pushLongWord = (word: string) => {
    let part = '';
    for (const ch of word) {
      const candidate = part + ch;
      if (part && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(part);
        part = ch;
      } else {
        part = candidate;
      }
    }
    return part;
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
      } else {
        current = pushLongWord(word);
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function drawDashedLine(
  page: PDFPage,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: ReturnType<typeof rgb>,
  thickness = 1,
  dash = 4,
  gap = 3
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len <= 0.01) return;
  const ux = dx / len;
  const uy = dy / len;
  let pos = 0;
  while (pos < len) {
    const segEnd = Math.min(len, pos + dash);
    page.drawLine({
      start: { x: x1 + ux * pos, y: y1 + uy * pos },
      end: { x: x1 + ux * segEnd, y: y1 + uy * segEnd },
      thickness,
      color,
    });
    pos += dash + gap;
  }
}

export async function buildReportPdf(
  model: ExportSessionModel,
  customFonts?: PdfReportFonts
): Promise<Uint8Array> {
  const fonts = customFonts ?? (await loadBrowserFonts());
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  pdfDoc.setTitle(`Báo cáo buổi tập sEMG - ${model.sessionShortId}`);
  pdfDoc.setAuthor('Smart sEMG Trainer');
  pdfDoc.setSubject('Báo cáo tổng kết và chi tiết co cơ sEMG');

  const regular = await pdfDoc.embedFont(fonts.regular, { subset: true });
  const bold = await pdfDoc.embedFont(fonts.bold, { subset: true });

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let cursorY = TOP_Y;

  const newPage = () => {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    cursorY = TOP_Y;
  };

  const ensureSpace = (neededHeight: number): boolean => {
    if (cursorY - neededHeight < BOTTOM_Y) {
      newPage();
      return true;
    }
    return false;
  };

  const drawCallout = (
    title: string,
    body: string,
    bgColor: ReturnType<typeof rgb>,
    borderColor: ReturnType<typeof rgb>,
    titleColor: ReturnType<typeof rgb>
  ) => {
    const lines = wrapText(body, regular, 8.8, CONTENT_W - 22);
    const boxH = 22 + lines.length * 12;
    ensureSpace(boxH + 6);
    const bottom = cursorY - boxH;
    page.drawRectangle({
      x: MARGIN_X,
      y: bottom,
      width: CONTENT_W,
      height: boxH,
      color: bgColor,
      borderColor,
      borderWidth: 0.9,
    });
    page.drawText(cleanPdfText(title), {
      x: MARGIN_X + 10,
      y: cursorY - 14,
      size: 9,
      font: bold,
      color: titleColor,
    });
    lines.forEach((ln, idx) => {
      page.drawText(ln, {
        x: MARGIN_X + 10,
        y: cursorY - 26 - idx * 12,
        size: 8.6,
        font: regular,
        color: C_TEXT,
      });
    });
    cursorY = bottom - 8;
  };

  // --- Header Band ---
  const headerH = 54;
  page.drawRectangle({
    x: MARGIN_X,
    y: cursorY - headerH,
    width: CONTENT_W,
    height: headerH,
    color: C_PRIMARY,
  });
  page.drawText('BÁO CÁO BUỔI TẬP sEMG', {
    x: MARGIN_X + 14,
    y: cursorY - 23,
    size: 15,
    font: bold,
    color: C_WHITE,
  });
  page.drawText(
    `Smart sEMG Trainer · ${model.channelMuscleLabelVi} · Xuất lúc ${model.exportedAt.toLocaleString('vi-VN')}`,
    {
      x: MARGIN_X + 14,
      y: cursorY - 41,
      size: 8.8,
      font: regular,
      color: rgb(0.92, 0.97, 0.94),
    }
  );
  cursorY -= headerH + 12;

  if (model.sourceWarningVi) {
    drawCallout(
      `Lưu ý nguồn dữ liệu: ${model.sourceLabelVi}`,
      model.sourceWarningVi,
      C_AMBER_BG,
      C_AMBER,
      C_AMBER
    );
  }

  if (model.isInProgress) {
    drawCallout(
      'Phiên chưa kết thúc',
      'Báo cáo được tạo từ bản chụp nhất quán khi buổi tập vẫn đang diễn ra. Các chỉ số có thể tiếp tục thay đổi cho tới khi kết thúc phiên.',
      C_BLUE_BG,
      C_BLUE,
      C_BLUE
    );
  }

  // --- Section A: Tổng kết ---
  ensureSpace(115);
  page.drawText('A. TỔNG KẾT BUỔI TẬP', {
    x: MARGIN_X,
    y: cursorY - 12,
    size: 11,
    font: bold,
    color: C_PRIMARY_DARK,
  });
  cursorY -= 20;

  // 4 KPI Boxes
  const kpiGap = 8;
  const kpiW = (CONTENT_W - kpiGap * 3) / 4;
  const kpiH = 56;
  const kpis = [
    {
      label: 'LẦN CO HỢP LỆ',
      value: model.isFreeMode ? `${model.validCount}` : `${model.validCount} / ${model.target ?? 0}`,
      sub: model.isFreeMode ? 'Chế độ Đếm tự do' : `Ghi nhận: ${model.totalCount} lần`,
    },
    {
      label: 'HOÀN THÀNH MỤC TIÊU',
      value:
        model.goalCompletionPct !== null
          ? `${model.goalCompletionPct.toFixed(1).replace('.', ',')}%`
          : 'Không áp dụng',
      sub: model.goalStatusVi,
    },
    {
      label: 'TỶ LỆ CO HỢP LỆ',
      value:
        model.validRatePct !== null
          ? `${model.validRatePct.toFixed(1).replace('.', ',')}%`
          : '0/0',
      sub:
        model.totalCount > 0
          ? `${model.validCount}/${model.totalCount} lần ghi nhận`
          : 'Chưa có lần co nào',
    },
    {
      label: 'THỜI LƯỢNG',
      value: model.durationDisplay,
      sub: model.sessionStateLabelVi,
    },
  ];

  const kpiBottom = cursorY - kpiH;
  kpis.forEach((k, idx) => {
    const x = MARGIN_X + idx * (kpiW + kpiGap);
    page.drawRectangle({
      x,
      y: kpiBottom,
      width: kpiW,
      height: kpiH,
      color: C_PRIMARY_BG,
      borderColor: C_BORDER,
      borderWidth: 0.7,
    });
    page.drawText(k.label, {
      x: x + 8,
      y: cursorY - 13,
      size: 6.8,
      font: bold,
      color: C_MUTED,
    });
    const valLines = wrapText(k.value, bold, 12.5, kpiW - 14);
    page.drawText(valLines[0]!, {
      x: x + 8,
      y: cursorY - 31,
      size: valLines[0]!.length > 11 ? 10 : 12.5,
      font: bold,
      color: C_PRIMARY_DARK,
    });
    const subLines = wrapText(k.sub, regular, 7.2, kpiW - 14);
    page.drawText(subLines[0]!, {
      x: x + 8,
      y: cursorY - 46,
      size: 7.2,
      font: regular,
      color: C_TEXT,
    });
  });
  cursorY = kpiBottom - 10;

  // Progress bar for training mode (capped at 100%, showing real count even when exceeding goal)
  if (!model.isFreeMode && model.target !== null && model.target > 0) {
    ensureSpace(28);
    const barLabel = `Thanh tiến độ mục tiêu (giới hạn hiển thị 100%): ${model.validCount} / ${model.target} lượt (${model.goalCompletionPct!.toFixed(1).replace('.', ',')}%)`;
    page.drawText(barLabel, {
      x: MARGIN_X,
      y: cursorY - 10,
      size: 8.2,
      font: regular,
      color: C_MUTED,
    });
    const trackY = cursorY - 21;
    page.drawRectangle({
      x: MARGIN_X,
      y: trackY,
      width: CONTENT_W,
      height: 7,
      color: rgb(0.91, 0.935, 0.90),
    });
    const fillW = (CONTENT_W * model.goalProgressBarPct) / 100;
    if (fillW > 0) {
      page.drawRectangle({
        x: MARGIN_X,
        y: trackY,
        width: fillW,
        height: 7,
        color: model.goalMet ? C_PRIMARY : C_AMBER,
      });
    }
    cursorY = trackY - 10;
  }

  // Summary Key-Value Table
  const summaryRows: Array<[string, string]> = [
    [
      'Thời gian bắt đầu',
      `${model.startedAtDisplayVi}${model.startedAtEstimated ? ' (ước lượng theo giờ thiết bị nhận gói tin)' : ''}`,
    ],
    ['Thời lượng buổi tập', `${model.durationDisplay} (${(model.durationMs / 1000).toFixed(1).replace('.', ',')} giây)`],
    ['Chế độ hoạt động', model.modeLabelVi],
    ['Kênh đo & vị trí đặt điện cực', `Kênh CH1 · Vị trí đặt điện cực: ${model.muscleLabelVi}`],
    ['Các dạng dữ liệu trên kênh CH1', 'Tín hiệu gốc (RAW) → Tín hiệu lọc số → Biên độ RMS / Envelope (cùng 1 kênh CH1)'],
    ['Nguồn dữ liệu', `${model.sourceLabelVi} · ${model.frame.device_name}`],
    ['Trạng thái phiên', model.sessionStateLabelVi],
    [
      'Mục tiêu / Hợp lệ / Tổng',
      model.isFreeMode
        ? `Không đặt mục tiêu · Hợp lệ: ${model.validCount} · Không hợp lệ: ${model.invalidCount} · Tổng ghi nhận: ${model.totalCount}`
        : `Mục tiêu: ${model.target ?? 0} · Hợp lệ: ${model.validCount} · Không hợp lệ: ${model.invalidCount} · Tổng ghi nhận: ${model.totalCount}`,
    ],
    [
      'Mức hoàn thành mục tiêu',
      model.goalCompletionPct !== null
        ? `${model.goalCompletionPct.toFixed(1).replace('.', ',')}% (${model.validCount}/${model.target}) — ${model.goalStatusVi}`
        : model.goalStatusVi,
    ],
    ['Tỷ lệ lần co hợp lệ', model.validRateDisplayVi],
    ['Điều kiện đánh giá áp dụng', model.evaluationConditionsVi.join(' ')],
  ];
  if (model.missingDataNotes.length > 0) {
    summaryRows.push(['Ghi chú tính đầy đủ dữ liệu', model.missingDataNotes.join(' ')]);
  }

  const keyColW = 165;
  const valColW = CONTENT_W - keyColW;
  for (let i = 0; i < summaryRows.length; i++) {
    const [k, v] = summaryRows[i]!;
    const kLines = wrapText(k, bold, 8.4, keyColW - 14);
    const vLines = wrapText(v, regular, 8.4, valColW - 14);
    const lineCount = Math.max(kLines.length, vLines.length);
    const rowH = Math.max(19, lineCount * 11.5 + 8);
    ensureSpace(rowH);
    const rowBottom = cursorY - rowH;
    if (i % 2 === 0) {
      page.drawRectangle({
        x: MARGIN_X,
        y: rowBottom,
        width: CONTENT_W,
        height: rowH,
        color: C_ROW_ALT,
      });
    }
    page.drawLine({
      start: { x: MARGIN_X, y: rowBottom },
      end: { x: MARGIN_X + CONTENT_W, y: rowBottom },
      thickness: 0.4,
      color: C_BORDER,
    });
    kLines.forEach((ln, li) => {
      page.drawText(ln, {
        x: MARGIN_X + 7,
        y: cursorY - 12 - li * 11.5,
        size: 8.4,
        font: bold,
        color: C_TEXT,
      });
    });
    vLines.forEach((ln, li) => {
      page.drawText(ln, {
        x: MARGIN_X + keyColW + 7,
        y: cursorY - 12 - li * 11.5,
        size: 8.4,
        font: regular,
        color: C_TEXT,
      });
    });
    cursorY = rowBottom;
  }
  cursorY -= 14;

  // --- Section B: Biểu đồ tín hiệu ---
  if (!model.hasSignalSeries) {
    ensureSpace(64);
    page.drawText('B. BIỂU ĐỒ TÍN HIỆU THEO THỜI GIAN', {
      x: MARGIN_X,
      y: cursorY - 12,
      size: 11,
      font: bold,
      color: C_PRIMARY_DARK,
    });
    cursorY -= 20;
    drawCallout(
      'Không có chuỗi tín hiệu RMS/envelope',
      'Phiên này không lưu chuỗi điểm RMS theo thời gian nên không thể vẽ biểu đồ (không tạo biểu đồ giả).',
      C_SLATE_BG,
      C_BORDER,
      C_MUTED
    );
  } else {
    const blockH = 248;
    ensureSpace(blockH);
    page.drawText('B. BIỂU ĐỒ RMS / ENVELOPE THEO THỜI GIAN', {
      x: MARGIN_X,
      y: cursorY - 12,
      size: 11,
      font: bold,
      color: C_PRIMARY_DARK,
    });
    cursorY -= 20;

    const chartBoxH = 192;
    const chartBoxBottom = cursorY - chartBoxH;
    page.drawRectangle({
      x: MARGIN_X,
      y: chartBoxBottom,
      width: CONTENT_W,
      height: chartBoxH,
      color: C_WHITE,
      borderColor: C_BORDER,
      borderWidth: 0.8,
    });

    const plotX = MARGIN_X + 46;
    const plotY = chartBoxBottom + 30;
    const plotW = CONTENT_W - 60;
    const plotH = chartBoxH - 46;

    const validSamples = model.samples.filter(s => s.rms !== null && Number.isFinite(s.rms));
    const minT = (model.samples[0]?.t_ms ?? 0) / 1000;
    const rawMaxT = (model.samples.at(-1)?.t_ms ?? 0) / 1000;
    const maxT = Math.max(rawMaxT, minT + 1);

    let maxRms = 1;
    let maxThr = 0;
    for (const s of model.samples) {
      if (s.rms !== null && Number.isFinite(s.rms)) maxRms = Math.max(maxRms, s.rms);
      maxThr = Math.max(maxThr, s.on_threshold, s.off_threshold);
    }
    const yMax = Math.max(
      model.frame.y_max || 1,
      maxRms * 1.1,
      maxThr * 1.15,
      model.zoneHighValue ? model.zoneHighValue * 1.1 : 1
    );

    const xOf = (tS: number) => plotX + ((tS - minT) / (maxT - minT)) * plotW;
    const yOf = (val: number) => plotY + Math.max(0, Math.min(1, val / yMax)) * plotH;

    // Plot background + grid
    page.drawRectangle({
      x: plotX,
      y: plotY,
      width: plotW,
      height: plotH,
      color: rgb(0.995, 0.998, 0.995),
      borderColor: C_BORDER,
      borderWidth: 0.6,
    });

    // Target zone shading
    if (model.zoneEnabled && model.zoneLowValue !== null && model.zoneHighValue !== null) {
      const zy1 = yOf(model.zoneLowValue);
      const zy2 = yOf(model.zoneHighValue);
      if (zy2 > zy1) {
        page.drawRectangle({
          x: plotX,
          y: zy1,
          width: plotW,
          height: zy2 - zy1,
          color: rgb(0.86, 0.945, 0.895),
          opacity: 0.7,
        });
      }
    }

    // Event interval shading & labels (clamped inside plot box)
    for (const ev of model.events) {
      const sClamped = Math.max(minT, Math.min(maxT, ev.startTimeS));
      const eClamped = Math.max(minT, Math.min(maxT, ev.endTimeS));
      if (eClamped <= sClamped) continue;
      const ex1 = xOf(sClamped);
      const ex2 = xOf(eClamped);
      const ew = Math.max(1.5, ex2 - ex1);
      const evColor =
        ev.status === 'valid'
          ? rgb(0.84, 0.935, 0.88)
          : ev.status === 'invalid'
            ? rgb(0.985, 0.89, 0.875)
            : rgb(0.9, 0.92, 0.91);
      const markerColor =
        ev.status === 'valid' ? C_PRIMARY : ev.status === 'invalid' ? C_RED : C_SLATE;
      page.drawRectangle({
        x: ex1,
        y: plotY,
        width: ew,
        height: plotH,
        color: evColor,
        opacity: 0.55,
      });
      page.drawLine({
        start: { x: ex1, y: plotY + plotH },
        end: { x: ex2, y: plotY + plotH },
        thickness: 2,
        color: markerColor,
      });
      if (ew >= 13) {
        page.drawText(`#${ev.eventId}`, {
          x: ex1 + 2,
          y: plotY + plotH - 9,
          size: 6.5,
          font: bold,
          color: markerColor,
        });
      }
    }

    // Horizontal Y grid + labels
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const frac = i / yTicks;
      const y = plotY + frac * plotH;
      const val = yMax * frac;
      if (i > 0 && i < yTicks) {
        drawDashedLine(page, plotX, y, plotX + plotW, y, rgb(0.9, 0.92, 0.89), 0.5, 2, 3);
      }
      const lbl = val >= 100 ? Math.round(val).toString() : val.toFixed(1);
      const lblW = regular.widthOfTextAtSize(lbl, 7);
      page.drawText(lbl, {
        x: plotX - lblW - 4,
        y: y - 2.5,
        size: 7,
        font: regular,
        color: C_MUTED,
      });
    }

    // Y-axis unit label
    const yUnitTitle = `${model.signalKind === 'ENVELOPE' ? 'Envelope' : 'RMS'} (${model.unitLabelVi})`;
    page.drawText(yUnitTitle, {
      x: MARGIN_X + 6,
      y: chartBoxBottom + chartBoxH - 12,
      size: 7.5,
      font: bold,
      color: C_TEXT,
    });

    // X-axis ticks + label
    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
      const frac = i / xTicks;
      const tVal = minT + (maxT - minT) * frac;
      const x = plotX + frac * plotW;
      const lbl = tVal.toFixed(maxT - minT < 10 ? 1 : 0);
      const lblW = regular.widthOfTextAtSize(lbl, 7);
      const clampedX = Math.max(plotX, Math.min(plotX + plotW - lblW, x - lblW / 2));
      page.drawText(lbl, {
        x: clampedX,
        y: plotY - 10,
        size: 7,
        font: regular,
        color: C_MUTED,
      });
    }
    const xTitle = 'Thời gian (giây)';
    const xTitleW = bold.widthOfTextAtSize(xTitle, 7.5);
    page.drawText(xTitle, {
      x: plotX + (plotW - xTitleW) / 2,
      y: chartBoxBottom + 6,
      size: 7.5,
      font: bold,
      color: C_MUTED,
    });

    // Decimate threshold & RMS series preserving null gaps and threshold transitions
    const sampleStep = Math.max(1, Math.floor(model.samples.length / 460));
    const drawThresholdSeries = (
      getter: (s: (typeof model.samples)[number]) => number,
      color: ReturnType<typeof rgb>
    ) => {
      let prevPt: { x: number; y: number } | null = null;
      for (let i = 0; i < model.samples.length; i += sampleStep) {
        const s = model.samples[i]!;
        const x = xOf(s.t_ms / 1000);
        const y = yOf(getter(s));
        if (prevPt) {
          drawDashedLine(page, prevPt.x, prevPt.y, x, y, color, 0.9, 3.5, 2.5);
        }
        prevPt = { x, y };
      }
      const last = model.samples.at(-1);
      if (last && prevPt) {
        drawDashedLine(page, prevPt.x, prevPt.y, xOf(last.t_ms / 1000), yOf(getter(last)), color, 0.9, 3.5, 2.5);
      }
    };

    drawThresholdSeries(s => s.on_threshold, C_AMBER);
    drawThresholdSeries(s => s.off_threshold, C_SLATE);

    // Draw RMS trace with min-max decimation when dense, NEVER connecting across null gaps
    if (model.samples.length <= 900) {
      let prevPt: { x: number; y: number } | null = null;
      for (const s of model.samples) {
        if (s.rms === null || !Number.isFinite(s.rms)) {
          prevPt = null;
          continue;
        }
        const pt = { x: xOf(s.t_ms / 1000), y: yOf(s.rms) };
        if (prevPt) {
          page.drawLine({ start: prevPt, end: pt, thickness: 1.35, color: C_PRIMARY });
        }
        prevPt = pt;
      }
    } else {
      const buckets = 450;
      let prevPt: { x: number; y: number } | null = null;
      for (let b = 0; b < buckets; b++) {
        const startIdx = Math.floor((b * model.samples.length) / buckets);
        const endIdx = Math.floor(((b + 1) * model.samples.length) / buckets);
        let hasNull = false;
        let minVal = Infinity;
        let maxVal = -Infinity;
        let tMid = 0;
        let cnt = 0;
        for (let idx = startIdx; idx < endIdx; idx++) {
          const s = model.samples[idx]!;
          if (s.rms === null || !Number.isFinite(s.rms)) {
            hasNull = true;
            continue;
          }
          if (s.rms < minVal) minVal = s.rms;
          if (s.rms > maxVal) maxVal = s.rms;
          tMid += s.t_ms / 1000;
          cnt++;
        }
        if (cnt === 0) {
          prevPt = null;
          continue;
        }
        const bx = xOf(tMid / cnt);
        const yLo = yOf(minVal);
        const yHi = yOf(maxVal);
        if (hasNull) prevPt = null;
        if (prevPt) {
          page.drawLine({ start: prevPt, end: { x: bx, y: yLo }, thickness: 1.2, color: C_PRIMARY });
        }
        if (Math.abs(yHi - yLo) > 0.3) {
          page.drawLine({ start: { x: bx, y: yLo }, end: { x: bx, y: yHi }, thickness: 1.2, color: C_PRIMARY });
        }
        prevPt = { x: bx, y: yHi };
      }
    }

    if (validSamples.length === 1) {
      const s = validSamples[0]!;
      page.drawCircle({ x: xOf(s.t_ms / 1000), y: yOf(s.rms!), size: 2.2, color: C_PRIMARY });
    }

    // Legend directly under chart box
    cursorY = chartBoxBottom - 13;
    const legendItems: Array<{ label: string; color: ReturnType<typeof rgb>; kind: 'line' | 'dash' | 'box' }> = [
      { label: `RMS (${model.unitLabelVi})`, color: C_PRIMARY, kind: 'line' },
      { label: 'Ngưỡng co', color: C_AMBER, kind: 'dash' },
      { label: 'Ngưỡng thả', color: C_SLATE, kind: 'dash' },
      { label: 'Co đạt', color: C_PRIMARY, kind: 'box' },
      { label: 'Chưa đạt', color: C_RED, kind: 'box' },
    ];
    if (model.incompleteCount > 0) legendItems.push({ label: 'Chưa hoàn tất', color: C_SLATE, kind: 'box' });
    if (model.zoneEnabled) legendItems.push({ label: 'Vùng mục tiêu', color: rgb(0.45, 0.72, 0.56), kind: 'box' });

    let lx = MARGIN_X + 4;
    for (const item of legendItems) {
      if (item.kind === 'box') {
        page.drawRectangle({ x: lx, y: cursorY - 2, width: 8, height: 8, color: item.color });
      } else if (item.kind === 'dash') {
        drawDashedLine(page, lx, cursorY + 2, lx + 12, cursorY + 2, item.color, 1.2, 3, 2);
      } else {
        page.drawLine({ start: { x: lx, y: cursorY + 2 }, end: { x: lx + 12, y: cursorY + 2 }, thickness: 1.5, color: item.color });
      }
      const textX = lx + (item.kind === 'box' ? 11 : 15);
      page.drawText(item.label, { x: textX, y: cursorY - 0.5, size: 7.4, font: regular, color: C_TEXT });
      lx = textX + regular.widthOfTextAtSize(item.label, 7.4) + 11;
    }
    cursorY -= 16;

    if (model.thresholdHistory.length > 1) {
      const thNote =
        'Lịch sử thay đổi ngưỡng trong phiên: ' +
        model.thresholdHistory
          .map(tp => `${tp.timeS.toFixed(1)}s (co ${tp.onThreshold.toFixed(1)}, thả ${tp.offThreshold.toFixed(1)} ${model.unitLabelVi})`)
          .join(' → ');
      const thLines = wrapText(thNote, regular, 7.6, CONTENT_W);
      ensureSpace(thLines.length * 10 + 6);
      thLines.forEach((ln, idx) => {
        page.drawText(ln, {
          x: MARGIN_X,
          y: cursorY - idx * 10,
          size: 7.6,
          font: regular,
          color: C_MUTED,
        });
      });
      cursorY -= thLines.length * 10 + 8;
    }
  }

  // --- Section C: Chi tiết từng lần co cơ ---
  ensureSpace(54);
  page.drawText('C. CHI TIẾT TỪNG LẦN CO CƠ', {
    x: MARGIN_X,
    y: cursorY - 12,
    size: 11,
    font: bold,
    color: C_PRIMARY_DARK,
  });
  cursorY -= 20;

  if (model.events.length === 0) {
    drawCallout(
      'Chưa có chi tiết từng lần co cơ',
      model.missingEventDetails
        ? 'Phiên cũ chỉ lưu tổng kết số lần co cơ, không có danh sách chi tiết từng lần.'
        : 'Không có lần co cơ nào được ghi nhận trong phiên này.',
      C_SLATE_BG,
      C_BORDER,
      C_MUTED
    );
  } else {
    const cols = [
      { label: 'STT', w: 28 },
      { label: 'Kênh / Cơ', w: 78 },
      { label: 'Bắt đầu – Kết thúc', w: 84 },
      { label: 'Giữ', w: 46 },
      { label: `RMS TB / Đỉnh (${model.unitLabelVi})`, w: 80 },
      { label: 'Kết quả', w: 66 },
      { label: 'Lý do chưa đạt', w: CONTENT_W - (28 + 78 + 84 + 46 + 80 + 66) },
    ];

    const drawEventHeader = () => {
      const h = 24;
      const bottom = cursorY - h;
      page.drawRectangle({
        x: MARGIN_X,
        y: bottom,
        width: CONTENT_W,
        height: h,
        color: C_PRIMARY_BG,
        borderColor: C_BORDER,
        borderWidth: 0.7,
      });
      let x = MARGIN_X;
      for (const col of cols) {
        const hdrLines = wrapText(col.label, bold, 7.6, col.w - 6);
        page.drawText(hdrLines[0]!, {
          x: x + 4,
          y: cursorY - 11,
          size: 7.6,
          font: bold,
          color: C_PRIMARY_DARK,
        });
        if (hdrLines[1]) {
          page.drawText(hdrLines[1], {
            x: x + 4,
            y: cursorY - 20,
            size: 7.4,
            font: bold,
            color: C_PRIMARY_DARK,
          });
        }
        x += col.w;
      }
      cursorY = bottom;
    };

    ensureSpace(48);
    drawEventHeader();

    for (let idx = 0; idx < model.events.length; idx++) {
      const ev = model.events[idx]!;
      const rmsCell =
        ev.rmsMean !== null && ev.rmsPeak !== null
          ? `${ev.rmsMean.toFixed(1)} / ${ev.rmsPeak.toFixed(1)}`
          : 'Không có dữ liệu';
      const cells = [
        `#${ev.eventId}`,
        `CH1 · ${model.muscleLabelVi}`,
        `${ev.startTimeS.toFixed(2)}s – ${ev.endTimeS.toFixed(2)}s`,
        `${(ev.durationMs / 1000).toFixed(2)} s`,
        rmsCell,
        ev.statusVi,
        ev.reasonVi || '—',
      ];
      const wrappedCols = cells.map((txt, cIdx) =>
        wrapText(txt, cIdx === 5 ? bold : regular, 7.8, cols[cIdx]!.w - 8)
      );
      const maxLines = Math.max(...wrappedCols.map(w => w.length));
      const rowH = Math.max(20, maxLines * 10.5 + 8);
      if (ensureSpace(rowH)) {
        drawEventHeader();
      }
      const bottom = cursorY - rowH;
      if (idx % 2 === 1) {
        page.drawRectangle({
          x: MARGIN_X,
          y: bottom,
          width: CONTENT_W,
          height: rowH,
          color: C_ROW_ALT,
        });
      }
      page.drawLine({
        start: { x: MARGIN_X, y: bottom },
        end: { x: MARGIN_X + CONTENT_W, y: bottom },
        thickness: 0.4,
        color: C_BORDER,
      });

      let x = MARGIN_X;
      for (let cIdx = 0; cIdx < cols.length; cIdx++) {
        const wLines = wrappedCols[cIdx]!;
        const fontToUse = cIdx === 0 || cIdx === 5 ? bold : regular;
        const textColor =
          cIdx === 5
            ? ev.status === 'valid'
              ? C_PRIMARY
              : ev.status === 'invalid'
                ? C_RED
                : C_AMBER
            : C_TEXT;
        wLines.forEach((ln, li) => {
          page.drawText(ln, {
            x: x + 4,
            y: cursorY - 11.5 - li * 10.5,
            size: 7.8,
            font: fontToUse,
            color: textColor,
          });
        });
        x += cols[cIdx]!.w;
      }
      cursorY = bottom;
    }
    cursorY -= 12;
  }

  // Disclaimer box
  drawCallout(
    'Phạm vi sử dụng báo cáo',
    'Báo cáo này phản ánh dữ liệu ghi nhận được trong buổi tập trên Smart sEMG Trainer (bao gồm nhãn thuật toán hỗ trợ đếm lượt). Tài liệu không đưa ra kết luận chẩn đoán y khoa, tình trạng sức khỏe cơ hay hiệu quả điều trị.',
    C_SLATE_BG,
    C_BORDER,
    C_MUTED
  );

  // Page footer on all pages
  const allPages = pdfDoc.getPages();
  for (let i = 0; i < allPages.length; i++) {
    const p = allPages[i]!;
    p.drawLine({
      start: { x: MARGIN_X, y: 34 },
      end: { x: PAGE_W - MARGIN_X, y: 34 },
      thickness: 0.4,
      color: C_BORDER,
    });
    p.drawText(`Smart sEMG Trainer · Phiên ${model.sessionShortId} · Không thay thế chẩn đoán y khoa`, {
      x: MARGIN_X,
      y: 21,
      size: 7.5,
      font: regular,
      color: C_MUTED,
    });
    const pageStr = `Trang ${i + 1} / ${allPages.length}`;
    const pageStrW = regular.widthOfTextAtSize(pageStr, 7.5);
    p.drawText(pageStr, {
      x: PAGE_W - MARGIN_X - pageStrW,
      y: 21,
      size: 7.5,
      font: regular,
      color: C_MUTED,
    });
  }

  return pdfDoc.save();
}
