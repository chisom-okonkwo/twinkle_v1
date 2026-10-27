// Prepare private disposable fixtures for the opt-in live evaluation.
// Review/apply the generated SQL with the project owner tools; never commit it.
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const cases = JSON.parse(
  await readFile("tests/fixtures/reflection-evaluation.json", "utf8"),
).cases;
const users = Array.from(
  { length: 4 },
  () => ({
    id: randomUUID(),
    email: `twinkle-reflection-${randomUUID()}@example.invalid`,
    password: randomBytes(24).toString("hex"),
  }),
);
const sql = ["begin;"];
const q = (s) => "'" + s.replaceAll("'", "''") + "'";
for (const u of users) {
  sql.push(
    `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,created_at,updated_at) values(${
      q(u.id)
    },'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${
      q(u.email)
    },extensions.crypt(${
      q(u.password)
    },extensions.gen_salt('bf')),now(),'','','','',now(),now());`,
  );
  sql.push(
    `insert into public.context_preferences(user_id,enabled) values(${
      q(u.id)
    },false);`,
  );
}
const fixtures = cases.map((c, i) => ({
  ...c,
  user: i < 3 ? i : 3,
  earlyId: randomUUID(),
  lateId: randomUUID(),
}));
for (const c of fixtures) {
  const user = users[c.user];
  for (
    const [id, title, body, date] of [[
      c.earlyId,
      `Synthetic ${c.key} earlier`,
      c.early,
      "2020-01-10T12:00:00Z",
    ], [c.lateId, `Synthetic ${c.key} later`, c.late, "2026-09-10T12:00:00Z"]]
  ) {
    sql.push(
      `insert into public.notes(id,user_id,title,content,created_at) values(${
        q(id)
      },${q(user.id)},${q(title)},${q(body)},${q(date)});`,
    );
  }
}
// Enable only after creation; avoid starting historical context/embedding work.
for (const u of users) {
  sql.push(
    `update public.context_preferences set enabled=true where user_id=${
      q(u.id)
    };`,
  );
}
for (const c of fixtures) {
  sql.push(
    `insert into public.note_relations(note_id,related_id,user_id,explanation,origin_quote,related_quote,score) values(${
      q(c.earlyId)
    },${q(c.lateId)},${
      q(users[c.user].id)
    },'Synthetic candidate for bounded reflection evaluation',${q(c.early)},${
      q(c.late)
    },95);`,
  );
}
sql.push("commit;select 'synthetic reflection fixtures ready' as status;");
await writeFile(
  "/tmp/twinkle-reflection-fixtures.json",
  JSON.stringify({ users, fixtures }),
  { mode: 0o600 },
);
await writeFile("/tmp/twinkle-reflection-seed.sql", sql.join("\n"), {
  mode: 0o600,
});
console.log(
  "Prepared four disposable accounts and seven synthetic pairs; no credentials printed.",
);
