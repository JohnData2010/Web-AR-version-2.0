# Nhúng AR prototype vào Qualtrics

AR prototype được thiết kế để chạy trong iframe (trang cha có thể là Qualtrics). Tài liệu này mô tả cách nhúng và nhận dữ liệu trong survey Qualtrics.

---

## 1. Chuẩn bị: Deploy AR prototype lên URL public

Qualtrics cần **HTTPS** và URL **public** để nhúng iframe. Camera chỉ hoạt động trên HTTPS.

- **Cách nhanh:** Deploy lên **Netlify** hoặc **Vercel** (xem chi tiết trong [run_local.md](./run_local.md)).
- **Domain hiện tại (Vercel):**  
  [https://web-ar-version-1-0-deployed.vercel.app/](https://web-ar-version-1-0-deployed.vercel.app/)

**Lưu ý:** Cấu hình `netlify.toml` / `vercel.json` đã bật header cho phép nhúng iframe (`X-Frame-Options`, `frame-ancestors`) để tương thích Qualtrics.

---

## 2. URL của AR demo và tham số `cond`

- **Trang chính (demo):**  
  `https://web-ar-version-1-0-deployed.vercel.app/public/index.html`

- **Tham số điều kiện thí nghiệm:**  
  `?cond=1` … `?cond=8` (8 cell, khớp với spec trong `docs/stimulus_spec.md`).

**Ví dụ:**

- Điều kiện 1:  
  `https://web-ar-version-1-0-deployed.vercel.app/public/index.html?cond=1`
- Điều kiện 3:  
  `https://web-ar-version-1-0-deployed.vercel.app/public/index.html?cond=3`

Qualtrics có thể gán `cond` bằng **Embedded Data** (ví dụ `cond=1`) rồi dùng trong URL iframe.

---

## 3. Thêm iframe vào câu hỏi / block trong Qualtrics

### Cách 1: Block “Text” hoặc “Descriptive Text” với HTML

1. Trong survey, thêm **Block** mới hoặc mở một **Question**.
2. Chọn loại **Text** / **Descriptive Text** (hoặc nơi cho phép nhập **Rich Content**).
3. Chuyển sang chế độ **HTML** (nút “HTML” / “Source” trong editor).
4. Dán đoạn sau (có thể đổi `cond=1` theo điều kiện thí nghiệm):

```html
<div style="max-width: 480px; margin: 0 auto;">
  <iframe
    id="ar-demo-frame"
    src="https://web-ar-version-1-0-deployed.vercel.app/public/index.html?cond=1"
    title="AR Demo"
    allow="camera; microphone"
    style="width: 100%; height: 640px; border: none; border-radius: 16px;"
  ></iframe>
</div>
```

- **`allow="camera; microphone"`** là cần thiết để demo chạy (camera và microphone cho các filter).
- Có thể chỉnh `height` (ví dụ `700px`) cho phù hợp layout.

### Cách 2: Dùng Embedded Data để truyền `cond`

1. Trong **Survey Flow**, set **Embedded Data** (ví dụ tên: `condition`) = `1` … `8` (random hoặc theo block).
2. Trong phần HTML của câu hỏi chứa iframe, dùng cú pháp thay thế của Qualtrics:

```html
<div style="max-width: 480px; margin: 0 auto;">
  <iframe
    id="ar-demo-frame"
    src="https://web-ar-version-1-0-deployed.vercel.app/public/index.html?cond=${e://Field/condition}"
    title="AR Demo"
    allow="camera; microphone"
    style="width: 100%; height: 640px; border: none; border-radius: 16px;"
  ></iframe>
</div>
```

Như vậy mỗi người làm survey sẽ thấy đúng điều kiện được gán trong Flow.

---

## 4. Nhận dữ liệu từ AR prototype (postMessage)

AR prototype gửi hai loại message lên trang cha (Qualtrics):

| Message               | Khi nào gửi   | Mục đích |
|-----------------------|---------------|----------|
| `AR_PROTO_AUDIT`      | Khi trang demo load xong | Ghi nhận condition_id, tham số URL, validation (để audit). |
| `AR_PROTO_COMPLETE`   | Khi người dùng hoàn thành và thoát demo | Dữ liệu tổng kết: thời gian, tương tác, lag, v.v. |

Cấu trúc ví dụ **AR_PROTO_COMPLETE** (đây là dữ liệu chính để lưu vào Qualtrics):

```json
{
  "type": "AR_PROTO_COMPLETE",
  "payload": {
    "condition_id": 1,
    "tp": "...",
    "id": "...",
    "rt": "...",
    "device_type": "mobile",
    "camera_permission": "granted",
    "time_on_prototype_ms": 120000,
    "time_on_notice_ms": 15000,
    "view_details_clicked": true,
    "notice_review_opened_count": 1,
    "interaction_count": 5,
    "lag_flag": false
  }
}
```

Để **lưu vào Qualtrics**, bạn cần:

1. Trong **Survey Flow**, tạo sẵn các **Embedded Data** tương ứng (ví dụ: `ar_condition_id`, `ar_time_on_prototype_ms`, `ar_complete`, …).
2. Trong cùng block/câu hỏi chứa iframe, thêm **JavaScript** chạy trên trang survey, lắng nghe `message` từ iframe, khi nhận `AR_PROTO_COMPLETE` thì gọi API Qualtrics để set Embedded Data và (tuỳ thiết kế) chuyển sang câu hỏi tiếp theo.

### Ví dụ JavaScript (chạy trong Qualtrics)

Qualtrics cho phép thêm JS trong **Question** (mục “JavaScript” / “Add JavaScript”) hoặc trong **Look & Feel** → **Header/Footer**. Script phải chạy trên **cùng trang** với iframe.

Ví dụ đơn giản: khi nhận `AR_PROTO_COMPLETE`, set một vài Embedded Data và đánh dấu hoàn thành:

```javascript
Qualtrics.SurveyEngine.addOnload(function() {
  var that = this;
  function handleMessage(event) {
    if (!event.data || event.data.type !== "AR_PROTO_COMPLETE") return;
    var p = event.data.payload || {};
    Qualtrics.SurveyEngine.setEmbeddedData("ar_condition_id", p.condition_id);
    Qualtrics.SurveyEngine.setEmbeddedData("ar_time_on_prototype_ms", p.time_on_prototype_ms);
    Qualtrics.SurveyEngine.setEmbeddedData("ar_time_on_notice_ms", p.time_on_notice_ms);
    Qualtrics.SurveyEngine.setEmbeddedData("ar_device_type", p.device_type);
    Qualtrics.SurveyEngine.setEmbeddedData("ar_complete", "1");
    window.removeEventListener("message", handleMessage);
    that.clickNextButton(); // chuyển câu hỏi tiếp theo (tuỳ chọn)
  }
  window.addEventListener("message", handleMessage);
});
```

- Tên Embedded Data (`ar_condition_id`, …) cần khớp với tên đã khai báo trong Survey Flow.
- `clickNextButton()` chỉ dùng nếu bạn muốn tự động chuyển block sau khi hoàn thành; có thể bỏ và thay bằng nút “Tiếp tục” thủ công.

---

## 5. Kiểm tra nhanh (không cần Qualtrics)

Dùng **test harness** đi kèm project:

- URL: [https://web-ar-version-1-0-deployed.vercel.app/public/test-harness.html](https://web-ar-version-1-0-deployed.vercel.app/public/test-harness.html)
- Trang này nhúng iframe với `?cond=1` và log mọi `AR_PROTO_COMPLETE` ra màn hình. Bạn có thể kiểm tra payload trước khi tích hợp vào Qualtrics.

---

## 6. Lưu ý khi dùng trong survey thật

- **Camera:** Người tham gia cần bật camera và chấp nhận quyền truy cập trên trình duyệt (HTTPS).
- **Trình duyệt:** Nên dùng Chrome/Safari (Edge/Firefox thường vẫn được; cần test).
- **Mobile:** Demo hỗ trợ mobile; trên Qualtrics nên test cả desktop và mobile.
- **Điều kiện (cond):** Luôn truyền `cond=1`…`8` đúng với thiết kế thí nghiệm; prototype gửi lại `condition_id` trong `AR_PROTO_AUDIT` và `AR_PROTO_COMPLETE` để bạn đối chiếu.

Nếu bạn đã deploy lên Netlify/Vercel và cấu hình Embedded Data + JS như trên, AR prototype đã có thể nhúng và truyền dữ liệu về Qualtrics đúng cách.
