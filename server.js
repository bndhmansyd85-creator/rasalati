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

try {
  if (fs.existsSync(DB)) {
    db = JSON.parse(fs.readFileSync(DB, "utf8"));
  }
} catch {}

const save = () => {
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
};

const online = new Map();

app.use(express.json({ limit: "15mb" }));

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/register", (q, r) => {
  let name = String(q.body.name || "").trim();
  let phone = String(q.body.phone || "").trim();

  if (!name || !phone) {
    return r.status(400).json({
      error: "الاسم ورقم الهاتف مطلوبان"
    });
  }

  db.users[phone] ??= {
    phone,
    created: Date.now()
  };

  db.users[phone].name = name;

  save();

  r.json({
    user: db.users[phone]
  });
});

app.get("/api/messages/:p", (q, r) => {
  let me = q.headers["x-phone"];
  let p = q.params.p;

  r.json(
    db.messages.filter(
      m =>
        (m.from === me && m.to === p) ||
        (m.from === p && m.to === me)
    )
  );
});

app.post("/api/profile", (q, r) => {
  let p = q.body.phone;

  if (!db.users[p]) {
    return r.status(404).end();
  }

  db.users[p].name = String(
    q.body.name || db.users[p].name
  );

  db.users[p].bio = String(q.body.bio || "");

  if (q.body.avatar) {
    db.users[p].avatar = String(q.body.avatar).slice(
      0,
      2500000
    );
  }

  save();

  r.json(db.users[p]);
});

wss.on("connection", ws => {
  let me = null;

  ws.on("message", raw => {
    try {
      let x = JSON.parse(raw);

      if (x.type === "auth") {
        me = String(x.phone);

        online.set(me, ws);

        ws.send(
          JSON.stringify({
            type: "ready"
          })
        );

        return;
      }

      if (x.type === "typing") {
        let s = online.get(x.to);

        if (s?.readyState === 1) {
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

      if (x.type === "read") {
        let m = db.messages.find(
          a => a.id === x.id && a.to === me
        );

        if (m) {
          m.read = true;
          save();
        }

        return;
      }

      if (x.type === "message") {
        let to = String(x.to || "");
        let text = String(x.text || "");
        let kind = x.kind || "text";

        if (!me || !to || (!text && !x.media)) {
          return;
        }

        let m = {
          id: crypto.randomUUID(),
          from: me,
          to,
          text,
          kind,
          media: x.media || null,
          time: Date.now(),
          read: false
        };

        db.messages.push(m);

        save();

        for (let p of [to, me]) {
          let s = online.get(p);

          if (s?.readyState === 1) {
            s.send(
              JSON.stringify({
                type: "message",
                message: m
              })
            );
          }
        }
      }
    } catch {}
  });

  ws.on("close", () => {
    if (me && online.get(me) === ws) {
      online.delete(me);
    }
  });
});

/* هذا هو السطر الذي تم إصلاحه */
app.get("/{*splat}", (q, r) =>
  r.sendFile(
    path.join(__dirname, "public/index.html")
  )
);

server.listen(
  process.env.PORT || 3000
);
