const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DB = path.join(__dirname, "data.json");

let db = {
  users: {},
  messages: []
};

// تحميل قاعدة البيانات
try {
  if (fs.existsSync(DB)) {
    db = JSON.parse(fs.readFileSync(DB, "utf8"));
  }
} catch (e) {
  console.log("Database load error:", e);
}

// حفظ قاعدة البيانات
const save = () => {
  try {
    fs.writeFileSync(DB, JSON.stringify(db, null, 2));
  } catch (e) {
    console.log("Database save error:", e);
  }
};

const online = new Map();

app.use(express.json({ limit: "15mb" }));

// ملفات الموقع
app.use(express.static(path.join(__dirname, "public")));

// =========================
// تسجيل مستخدم
// =========================
app.post("/api/register", (q, r) => {
  const name = String(q.body.name || "").trim();
  const phone = String(q.body.phone || "").trim();

  if (!name || !phone) {
    return r.status(400).json({
      error: "الاسم ورقم الهاتف مطلوبان"
    });
  }

  if (!db.users[phone]) {
    db.users[phone] = {
      phone,
      created: Date.now()
    };
  }

  db.users[phone].name = name;

  save();

  r.json({
    user: db.users[phone]
  });
});

// =========================
// جلب الرسائل
// =========================
app.get("/api/messages/:p", (q, r) => {
  const me = q.headers["x-phone"];
  const p = q.params.p;

  const messages = db.messages.filter(
    m =>
      (m.from === me && m.to === p) ||
      (m.from === p && m.to === me)
  );

  r.json(messages);
});

// =========================
// تحديث الملف الشخصي
// =========================
app.post("/api/profile", (q, r) => {
  const p = q.body.phone;

  if (!db.users[p]) {
    return r.status(404).end();
  }

  db.users[p].name = String(
    q.body.name || db.users[p].name
  );

  db.users[p].bio = String(
    q.body.bio || ""
  );

  if (q.body.avatar) {
    db.users[p].avatar = String(q.body.avatar).slice(
      0,
      2500000
    );
  }

  save();

  r.json(db.users[p]);
});

// =========================
// WebSocket
// =========================
wss.on("connection", ws => {
  let me = null;

  ws.on("message", raw => {
    try {
      const x = JSON.parse(raw);

      // تسجيل الدخول
      if (x.type === "auth") {
        me = String(x.phone || "");

        if (me) {
          online.set(me, ws);
        }

        ws.send(
          JSON.stringify({
            type: "ready"
          })
        );

        return;
      }

      // جاري الكتابة
      if (x.type === "typing") {
        const s = online.get(x.to);

        if (s && s.readyState === WebSocket.OPEN) {
          s.send(
            JSON.stringify({
              type: "typing",
              from: me,
              active: !!x.active
            })
          );
        }

        return;
      }

      // قراءة الرسالة
      if (x.type === "read") {
        const m = db.messages.find(
          a =>
            a.id === x.id &&
            a.to === me
        );

        if (m) {
          m.read = true;
          save();
        }

        return;
      }

      // إرسال رسالة
      if (x.type === "message") {
        const to = String(x.to || "");
        const text = String(x.text || "");
        const kind = x.kind || "text";

        if (
          !me ||
          !to ||
          (!text && !x.media)
        ) {
          return;
        }

        const m = {
          id: crypto.randomUUID(),
          from: me,
          to: to,
          text: text,
          kind: kind,
          media: x.media || null,
          time: Date.now(),
          read: false
        };

        db.messages.push(m);
        save();

        // إرسال للمرسل والمستقبل
        for (const p of [to, me]) {
          const s = online.get(p);

          if (
            s &&
            s.readyState === WebSocket.OPEN
          ) {
            s.send(
              JSON.stringify({
                type: "message",
                message: m
              })
            );
          }
        }

        return;
      }

    } catch (e) {
      console.log("WebSocket error:", e);
    }
  });

  ws.on("close", () => {
    if (
      me &&
      online.get(me) === ws
    ) {
      online.delete(me);
    }
  });
});

// =========================
// الصفحة الرئيسية
// =========================

// مهم جدًا:
// لا تستخدم app.get("*")
// لأن Express الحديث يعطي الخطأ الموجود في Render.

app.use((q, r, next) => {
  if (q.method === "GET") {
    return r.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }

  next();
});

// =========================
// تشغيل السيرفر
// =========================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    `Rasalati server running on port ${PORT}`
  );
});
