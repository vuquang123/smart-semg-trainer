# Giao thức sEMG v1 và tích hợp ESP32

Mục tiêu: ESP32-WROOM-32 là nguồn trạng thái duy nhất. OLED SSD1306 và ứng dụng cùng đọc một session state. Không đếm số lượt lại trong trình duyệt. ESP32-S3 có thể dùng cùng hợp đồng nếu nhóm đổi phần cứng.

## Kênh truyền

- WebSocket JSON UTF-8, một object/message, `protocol: 1`.
- Truyền snapshot hiển thị mỗi 100–200 ms để bắt đầu thử nghiệm. Bản mô phỏng phát 100 ms/lần; đây không phải kết quả đo độ trễ phần cứng.
- Sampling và xử lý EMG trên MCU độc lập với tác vụ mạng/OLED. Không gửi mọi mẫu 2.048 Hz vào giao diện.
- Lệnh điều khiển có ưu tiên và hàng đợi riêng; STOP không xếp sau backlog dữ liệu hiển thị.
- Adapter không tự mở lại phiên hoặc phát lại lệnh START khi kết nối lại.

## Snapshot

```json
{
  "type": "snapshot",
  "protocol": 1,
  "device_id": "semg-esp32-001",
  "device_name": "sEMG Companion",
  "boot_id": "8de58f01-f7aa-4be7-958c-e70eec407ea1",
  "session_id": "706e9e68-2ff9-4c74-b346-558b344c1157",
  "sequence": 73,
  "cause": "tick",
  "started_at": "2026-10-18T05:30:00.000Z",
  "t_ms": 7200,
  "duration_ms": 4700,
  "state": "training",
  "phase": "relax",
  "selected_channel": 1,
  "channel_count": 1,
  "source": "sensor",
  "unit": "ADC",
  "y_max": 4095,
  "channels": [{"id":1,"rms":75,"on_threshold":400,"off_threshold":220}],
  "settings": {"muscle":"forearm","channel":1,"target":5,"min_hold_ms":500},
  "valid_count": 1,
  "total_count": 1,
  "current_hold_ms": 0,
  "last_hold_ms": 700,
  "calibration_progress": 1,
  "repetitions": [{"id":"ff926c1e-50fe-4515-9e72-4bd251018cf4","ordinal":1,"ended_ms":6500,"hold_ms":700,"valid":true}],
  "warning": null,
  "error": null
}
```

| Trường | Quy ước |
|---|---|
| `device_id` | ID ổn định của một bo, ví dụ từ MAC/eFuse; không coi ID công khai là bằng chứng sở hữu |
| `boot_id` | UUID mới mỗi lần firmware khởi động |
| `session_id` | UUID mới cho mỗi phiên, không lặp giữa các boot; giữ khi mất kết nối |
| `sequence` | Số tăng trong cùng phiên; gói lặp/cũ bị bỏ |
| `cause` | `tick`, `command`, `reset`, `state`; session mới chỉ được nhận từ `state` sau handshake hoặc `reset` |
| `started_at` | ISO UTC. Nếu MCU chưa biết thời gian, gateway phải gắn mốc và ghi rõ độ chính xác; không giả vờ RTC đúng |
| `t_ms` | Thời gian tương đối trong phiên, gồm hiệu chuẩn; tăng đơn điệu cả khi hiệu chuẩn lại |
| `duration_ms` | Thời gian phần tập, không gồm hiệu chuẩn; dừng khi phiên kết thúc |
| `state` | `idle`, `calibrating`, `ready`, `training`, `stopped`, `completed`, `error` |
| `phase` | `idle`, `relax`, `contract`, `hold`, `release`, `complete` |
| `source` | `simulation` hoặc `sensor`, độc lập loại transport |
| `channels` | Chỉ gửi kênh có thật; số phần tử khớp `channel_count` |
| `unit` | `ADC`, `a.u.`, `uV`; không tự xem RMS ADC là µV |
| `y_max` | Trần thang Y cố định của phiên, phải chứa ngưỡng co/thả |
| `repetitions` | Sổ kết quả đầy đủ trong phiên: ID, thứ tự, mốc kết thúc và thời gian giữ; không mất lượt khi bỏ gói hiển thị |

Nếu báo `source: sensor`, `unit: uV`, snapshot phải có metadata bổ sung:

```json
"conversion": {"uV_per_unit":1.25,"offset_uV":0,"reference":"ADC/reference/gain measured on bench; calibration ID ..."}
```

`rms`, các ngưỡng và `y_max` khi đó đã được firmware/gateway quy đổi cùng đơn vị. Hệ số quy đổi là mô tả kiểm chứng, không tự động chứng minh độ chính xác. Mapper từ chối µV cảm biến khi thiếu metadata. Mô phỏng dùng nhãn **RMS mô phỏng (µV)**, không cần tuyên bố hiệu chuẩn vật lý.

`total_count` bằng chiều dài sổ lượt, `valid_count` bằng số lượt có `valid=true`. Mỗi repetition ID phải duy nhất. Kênh tập phải có thật và khớp `settings.channel`. Sai giao thức không được phép cập nhật trạng thái.

## Lệnh và ACK

```json
{"type":"command","protocol":1,"command_id":"22c505d7-dc40-4730-af82-9e707f4b0760","session_id":"706e9e68-2ff9-4c74-b346-558b344c1157","action":"stop"}
```

Các action: `calibrate`, `start`, `stop`, `reset`, `get_state`. `calibrate` kèm `settings`; `start` có thể kèm cùng settings để phát hiện cấu hình cũ. `get_state` là read-only, bỏ qua session ID yêu cầu để lấy phiên hiện tại.

```json
{"type":"ack","protocol":1,"command_id":"22c505d7-dc40-4730-af82-9e707f4b0760","accepted":true,"snapshot":{ "...":"snapshot đầy đủ theo cấu trúc trên" }}
```

Khi từ chối: `accepted:false`, `message` giải thích và kèm snapshot hiện tại. Ví dụ trên là mô tả cấu trúc ACK; giá trị snapshot cần object đầy đủ, không phải dấu `...` khi truyền thật.

- Lưu cache command ID ở firmware để lệnh được gửi lại không tạo hai thao tác. Mô phỏng cache 256 ACK gần nhất.
- Bắt đầu: chỉ `ready → training`, sau hiệu chuẩn hợp lệ.
- Hiệu chuẩn: `idle/ready → calibrating → ready`; không đổi cấu hình lúc đang tập.
- Dừng: được ưu tiên trong hiệu chuẩn và tập; giữ mọi lượt đã xác nhận, loại bỏ lượt chưa hoàn thành; không tăng lượt sau trạng thái dừng.
- Đặt lại: chỉ ở `stopped/completed` hoặc lỗi đã cho phép xử lý; tạo UUID phiên mới, không xóa lịch sử phía ứng dụng.
- Không cung cấp Resume trong v1.
- UI chờ tối đa 6 giây cho ACK, không gửi nhiều lệnh thường song song; STOP có thể thay lệnh đang chờ. Không có ACK không đồng nghĩa với thiết bị không nhận lệnh. Snapshot trạng thái có thể xác nhận hành động.

## Reconnect và mất dữ liệu

1. Mở socket.
2. Gửi `get_state` có command ID mới.
3. Bỏ gói stream trước handshake; nhận ACK chứa snapshot mới nhất rồi mới chuyển thành đã kết nối.
4. Giữ PacketGate khi nối lại cùng adapter: bỏ gói có cùng/cũ sequence và các session đã nghỉ.
5. Không gửi START/RESET tự động. Sổ repetition trong snapshot phục hồi kết quả lượt; không dựng lại RMS không nhận được.
6. Khi `t_ms` giữa hai mẫu nhận được chênh hơn 450 ms, thêm điểm `null` đánh dấu khoảng trống. Đây không phải một mẫu đo giả. Nếu stream im hơn 2,5 giây, UI hiển thị mất kết nối/chưa xác nhận.

Firmware thật phải giữ sổ lượt và snapshot qua gián đoạn mạng. Nếu reboot làm mất sổ, dùng boot/session UUID mới và thông báo rằng không có phần dữ liệu cũ; không nối các phiên như một chuỗi liên tục. Cần thêm lưu bền/ACK sự kiện cho phiên rất dài hoặc nếu yêu cầu chống mất điện. Mô phỏng trong trình duyệt được khôi phục từ phiên lưu gần nhất khi tải lại, giữ ID và số lượt, chuyển sang đã dừng và không tạo bù dữ liệu nền. Hành vi này chỉ dành cho mock; không tự tuyên bố ESP32 đã dừng.

## Nhận diện lượt trên firmware

Dùng hysteresis: bắt đầu co khi RMS ≥ ngưỡng co; kết thúc khi RMS ≤ ngưỡng thả, ngưỡng thả nhỏ hơn ngưỡng co. Một lượt đạt chỉ được ghi sau cạnh thả và thời gian giữ ≥ `min_hold_ms`. Lượt ngắn vẫn ghi vào sổ với `valid:false`. Khi đạt mục tiêu valid_count, chuyển hoàn thành.

App không xác nhận lượt bằng việc nhìn thấy đường RMS vượt ngưỡng. Các tham số này chỉ điều khiển nhận diện luyện tập, không phải ngưỡng lâm sàng.

## Những việc phải sửa/kiểm tra trong firmware hiện tại

Chưa có mã firmware Blynk/OLED hiện tại trong đầu vào, nên **chưa thể ánh xạ chính xác tên trường hay xác nhận firmware tương thích**. `firmwareMapper.ts` hiện chỉ hỗ trợ v1 và từ chối gói legacy thiếu trường.

- [ ] Tách acquisition/DSP khỏi network, OLED và command handler; không dùng loop chặn làm STOP không nhận được.
- [ ] Thêm UUID boot/session, sequence, command ID và ACK.
- [ ] Xuất snapshot dùng chung cho OLED và socket; OLED không tự có bộ đếm khác.
- [ ] Ghi sổ lượt duy nhất; ưu tiên STOP và hủy START còn nằm trong hàng đợi.
- [ ] Cập nhật cả mục tiêu, kênh và thời gian giữ qua lệnh hiệu chuẩn.
- [ ] Chốt đơn vị RMS, hệ số gain/reference và cách kiểm chứng; ADC cần nêu số đếm hoặc a.u. khi chưa hiệu chuẩn.
- [ ] Giữ các ngưỡng/thang Y cố định suốt phiên; báo `rms:null` khi dữ liệu không có.
- [ ] Chọn cách phục vụ web nội bộ; thử kích thước bundle, phân vùng flash và heap WROOM-32. Không giả định bundle React đầy đủ vừa flash ESP32.
- [ ] Nếu public HTTPS: chọn gateway WSS hoặc TLS/cert hợp lệ, cơ chế ghép và xác thực thiết bị; thử Safari thật.
- [ ] Đo độ trễ OLED ↔ app bằng cùng `session_id/sequence/valid_count` và timestamp log; chưa có số đo hiện tại.

Giai đoạn đầu nên phục vụ app từ máy tính/gateway nội bộ để giảm áp lực flash/heap ESP32, rồi quyết định có rút gọn frontend cho bo hay không.


## Mở rộng timing và âm báo (v1.2)

Hợp đồng snapshot v1 giữ tương thích; bổ sung tùy chọn `capabilities:["timing_v1"]`, `device_clock_ms`, `sampled_at_device_ms`, `oled_sequence`. Chỉ capability này mới bật ping/pong đo clock; không có thì các phép đo là chưa biết. Xem `LATENCY.md` để triển khai và đo vật lý OLED.

Đếm ngược là bước chuẩn bị ở web khi thiết bị đang ready, trước START. STOP hủy đếm và không cho START chạy sau đó. Âm báo và minh họa sử dụng pha trong snapshot đã được xác nhận; không thay nguồn nhận diện hoặc bộ đếm của firmware.

## Bảo mật tầng ứng dụng WebSocket bằng TinyJAMBU-128 AEAD

Toàn bộ gói tin truyền qua WebSocket (`snapshot`, `command`, `ack`, `ping`, `pong`) giữa ESP32 và Web được đóng gói trong khung xác thực & mã hóa **TinyJAMBU-128 AEAD** (chuẩn NIST Lightweight Cryptography):

```json
{
  "type": "aead",
  "alg": "tinyjambu-128",
  "protocol": 1,
  "ad": "semg_v2:s2c",
  "nonce": "53454d470100000000000000",
  "ct": "<hex ciphertext + 8-byte tag>"
}
```

- **Khóa 128-bit (16 byte)**: Cấu hình tại `EMG_WS_AEAD_KEY_HEX` trong `main/emg_ui_config.h` (mặc định `000102030405060708090a0b0c0d0e0f`) và nhập tại mục **Thiết bị** trên ứng dụng Web. Hỗ trợ khóa Hex 32 ký tự hoặc dẫn xuất khóa tự động từ mật khẩu thông qua `TinyJAMBU-128`.
- **Nonce 96-bit (12 byte)**: Gồm 4 byte định danh phiên/boot kết hợp bộ đếm gói tin 64-bit tăng đơn điệu theo chiều gửi, đảm bảo không bao giờ tái sử dụng Nonce.
- **Associated Data (`ad`)**: Phân biệt chiều truyền `semg_v2:s2c` (ESP32 → Web) và `semg_v2:c2s` (Web → ESP32), chống tấn công phản xạ (Reflection Attack) và giả mạo lệnh điều khiển trong mạng LAN.
