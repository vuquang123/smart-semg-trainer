import type { ExportSessionModel } from './exportModel';
import {
  buildXlsxWorkbook,
  dateCell,
  numCell,
  strCell,
  type XlsxCell,
  type XlsxSheetSpec,
} from './xlsxWriter';

export async function buildReportXlsx(model: ExportSessionModel): Promise<Uint8Array> {
  const unit = model.unitLabelVi;

  // Sheet 1: Tổng kết
  const summaryRows: XlsxCell[][] = [
    [strCell('Hạng mục', 1), strCell('Giá trị', 1), strCell('Đơn vị / Ghi chú', 1)],
  ];

  if (model.sourceWarningVi) {
    summaryRows.push([
      strCell('Cảnh báo nguồn dữ liệu', 8),
      strCell(model.sourceWarningVi, 8),
      strCell('Không phải phép đo trực tiếp trong buổi tập mới', 8),
    ]);
  }
  if (model.isInProgress) {
    summaryRows.push([
      strCell('Trạng thái chụp dữ liệu', 8),
      strCell('Phiên chưa kết thúc tại thời điểm xuất', 8),
      strCell(`Xuất lúc ${model.exportedAtIso}`, 8),
    ]);
  }

  summaryRows.push(
    [strCell('Mã phiên rút gọn', 0), strCell(model.sessionShortId, 0), strCell(model.sessionId, 0)],
    [
      strCell('Thời gian bắt đầu', 0),
      dateCell(model.startedAtDate),
      strCell(model.startedAtEstimated ? 'Giờ địa phương (ước lượng theo đồng hồ ứng dụng)' : 'Giờ địa phương', 0),
    ],
    [strCell('Thời lượng tập', 0), numCell(model.durationMs / 1000, 3), strCell(`giây (${model.durationDisplay})`, 0)],
    [strCell('Thời lượng (ms)', 0), numCell(model.durationMs, 2), strCell('ms', 0)],
    [strCell('Chế độ hoạt động', 0), strCell(model.modeLabelVi, 0), strCell(model.modeCode, 0)],
    [strCell('Kênh đo & vị trí đặt điện cực', 0), strCell(`CH1 · ${model.muscleLabelVi}`, 0), strCell('Vùng cơ là thông tin vị trí đặt điện cực của phiên trên 1 kênh CH1', 0)],
    [strCell('Các dạng dữ liệu trên kênh CH1', 0), strCell('RAW → Tín hiệu lọc số → RMS / Envelope', 0), strCell('Các dạng dữ liệu của cùng một kênh CH1, không phải kênh độc lập', 0)],
    [strCell('Nguồn dữ liệu', 0), strCell(model.sourceLabelVi, 0), strCell(model.frame.device_name, 0)],
    [strCell('Trạng thái phiên', 0), strCell(model.sessionStateLabelVi, 0), strCell(model.sessionStateCode, 0)],
    [
      strCell('Mục tiêu số lần co cơ', 0),
      model.target === null ? strCell('Không đặt mục tiêu', 0) : numCell(model.target, 2),
      strCell(model.isFreeMode ? 'Chế độ Đếm tự do' : 'lần', 0),
    ],
    [strCell('Tổng số lần hệ thống ghi nhận', 0), numCell(model.totalCount, 2), strCell('lần', 0)],
    [strCell('Số lần hợp lệ', 0), numCell(model.validCount, 2), strCell('lần', 0)],
    [strCell('Số lần không hợp lệ', 0), numCell(model.invalidCount, 2), strCell('lần', 0)],
    [strCell('Số lần chưa hoàn tất khi dừng/xuất', 0), numCell(model.incompleteCount, 2), strCell('Không cộng vào tổng số lần hoàn chỉnh', 0)],
    [
      strCell('Mức hoàn thành mục tiêu', 0),
      model.goalCompletionRatio !== null ? numCell(model.goalCompletionRatio, 5) : strCell(model.goalStatusVi, 0),
      strCell(
        model.goalCompletionPct !== null
          ? `${model.goalStatusVi} (${model.validCount}/${model.target})`
          : model.goalStatusVi,
        0
      ),
    ],
    [
      strCell('Tỷ lệ lần co hợp lệ', 0),
      model.validRateRatio !== null ? numCell(model.validRateRatio, 5) : strCell('Không xác định (mẫu số = 0)', 0),
      strCell(
        model.totalCount > 0 ? `Số lần hợp lệ / Tổng số lần ghi nhận (${model.validCount}/${model.totalCount})` : 'Chưa có lần co cơ nào được ghi nhận',
        0
      ),
    ],
    [strCell('Thời gian giữ tối thiểu', 0), numCell(model.minHoldMs, 2), strCell(model.isFreeMode ? 'ms (không áp dụng ở Đếm tự do)' : 'ms', 0)],
    [strCell('Ngưỡng co (CH1)', 0), numCell(model.onThreshold, 3), strCell(unit, 0)],
    [strCell('Ngưỡng thả (CH1)', 0), numCell(model.offThreshold, 3), strCell(unit, 0)],
    [strCell('Tập theo vùng mục tiêu', 0), strCell(model.zoneEnabled ? 'Có' : 'Không', 0), strCell(model.zoneEnabled ? `${model.zoneLowPct}–${model.zoneHighPct}% mốc tham chiếu` : '', 0)],
    [strCell('Mốc RMS tham chiếu', 0), numCell(model.referenceRms, 3), strCell(model.referenceRms !== null ? unit : 'Chưa đặt', 0)],
    [strCell('Khoảng gián đoạn mẫu RMS', 0), numCell(model.gapsCount, 2), strCell('Số đoạn trống trên luồng hiển thị', 0)],
    [
      strCell('Ghi chú dữ liệu', 0),
      strCell(model.missingDataNotes.length ? model.missingDataNotes.join(' ') : 'Đầy đủ chuỗi tín hiệu và chi tiết các lần co cơ.', 7),
      strCell('Chỉ dùng theo dõi luyện tập, không phải kết luận y khoa.', 7),
    ]
  );

  if (model.thresholdHistory.length > 1) {
    summaryRows.push([
      strCell('Lịch sử thay đổi ngưỡng trong phiên', 1),
      strCell('Giá trị ngưỡng co / thả', 1),
      strCell('Mốc thời gian & sự kiện', 1),
    ]);
    for (const tp of model.thresholdHistory) {
      summaryRows.push([
        strCell('Ngưỡng CH1', 0),
        strCell(`Co: ${tp.onThreshold.toFixed(1)} · Thả: ${tp.offThreshold.toFixed(1)} ${unit}`, 0),
        strCell(`${tp.timeS.toFixed(2)} s (${tp.event})`, 0),
      ]);
    }
  }

  const summarySheet: XlsxSheetSpec = {
    name: 'Tổng kết',
    columns: [34, 30, 44],
    rows: summaryRows,
    freezeHeader: true,
    autoFilter: true,
  };

  // Sheet 2: Từng lần co cơ
  const eventsHeader: XlsxCell[] = [
    strCell('STT', 1),
    strCell('Kênh', 1),
    strCell('Vùng cơ (vị trí điện cực)', 1),
    strCell('Bắt đầu (s)', 1),
    strCell('Kết thúc (s)', 1),
    strCell('Thời gian giữ (ms)', 1),
    strCell('Thời gian giữ (s)', 1),
    strCell('Nghỉ trước đó (s)', 1),
    strCell('Trong vùng (s)', 1),
    strCell(`RMS trung bình (${unit})`, 1),
    strCell(`RMS cực đại (${unit})`, 1),
    strCell('Kết quả', 1),
    strCell('Lý do chưa đạt', 1),
    strCell('Nguồn nhãn', 1),
  ];
  const eventRows: XlsxCell[][] = [eventsHeader];

  if (model.events.length === 0) {
    eventRows.push([
      strCell(
        model.missingEventDetails
          ? 'Phiên cũ chỉ lưu tổng kết số lần co cơ, không có dữ liệu chi tiết từng lần.'
          : 'Không có lần co cơ nào được ghi nhận trong phiên này.',
        7
      ),
    ]);
  } else {
    for (const ev of model.events) {
      eventRows.push([
        numCell(ev.eventId, 2),
        strCell('CH1', 0),
        strCell(model.muscleLabelVi, 0),
        numCell(ev.startTimeS, 9),
        numCell(ev.endTimeS, 9),
        numCell(ev.durationMs, 2),
        numCell(ev.durationMs / 1000, 4),
        numCell(ev.restBeforeMs !== null ? ev.restBeforeMs / 1000 : null, 4),
        numCell(ev.inZoneMs !== null ? ev.inZoneMs / 1000 : null, 4),
        numCell(ev.rmsMean, 4),
        numCell(ev.rmsPeak, 4),
        strCell(ev.statusVi, 0),
        strCell(ev.reasonVi, 7),
        strCell(ev.labelSource === 'algorithm_predicted' ? 'Thuật toán phát hiện (nhãn dự đoán)' : ev.labelSource, 0),
      ]);
    }
  }

  const eventsSheet: XlsxSheetSpec = {
    name: 'Từng lần co cơ',
    columns: [8, 8, 13, 13, 13, 18, 16, 16, 15, 20, 18, 15, 36, 28],
    rows: eventRows,
    freezeHeader: true,
    autoFilter: model.events.length > 0,
  };

  const sheets: XlsxSheetSpec[] = [summarySheet, eventsSheet];

  // Sheet 3: Dữ liệu biểu đồ (chỉ tạo khi có chuỗi tín hiệu thật)
  if (model.hasSignalSeries) {
    const hasFiltered = model.samples.some(
      s => s.filtered !== undefined && s.filtered !== null && Number.isFinite(s.filtered)
    );
    const chartHeader: XlsxCell[] = [
      strCell('Thời gian (s)', 1),
      strCell('Thời gian (ms)', 1),
      strCell('Kênh đo', 1),
      strCell('Vùng cơ (vị trí điện cực)', 1),
      ...(hasFiltered ? [strCell(`Tín hiệu lọc CH1 (${unit})`, 1)] : []),
      strCell(`RMS / Envelope CH1 (${unit})`, 1),
      strCell(`Ngưỡng co CH1 (${unit})`, 1),
      strCell(`Ngưỡng thả CH1 (${unit})`, 1),
      strCell('Mức kích hoạt (%)', 1),
      strCell('Vùng mục tiêu', 1),
    ];
    const chartRows: XlsxCell[][] = [chartHeader];
    for (const s of model.samples) {
      const row: XlsxCell[] = [
        numCell(s.t_ms / 1000, 9),
        numCell(s.t_ms, 2),
        strCell('CH1', 0),
        strCell(model.muscleLabelVi, 0),
        ...(hasFiltered ? [numCell(s.filtered ?? null, 4)] : []),
        numCell(s.rms, 4),
        numCell(s.on_threshold, 4),
        numCell(s.off_threshold, 4),
        numCell(s.activation_pct ?? null, 3),
        strCell(s.target_zone ?? '', 0),
      ];
      chartRows.push(row);
    }

    sheets.push({
      name: 'Dữ liệu biểu đồ',
      columns: hasFiltered ? [14, 15, 10, 24, 22, 24, 18, 18, 18, 15] : [14, 15, 10, 24, 24, 18, 18, 18, 15],
      rows: chartRows,
      freezeHeader: true,
      autoFilter: true,
    });
  }

  return buildXlsxWorkbook(sheets);
}
