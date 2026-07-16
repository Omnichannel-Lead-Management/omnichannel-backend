# Mentor Presentation — Casual Speaking Script

**Project:** Omnichannel Lead Management Platform  
**Time:** About 10–15 minutes  
**Tip:** Don't memorize every line. Talk naturally. Look at the slide, then say the main idea.

---

## SLIDE 1 — Title (about 1 minute)

**Who speaks:** Anyone — take turns introducing the team

> Hi, good morning / good afternoon.
>
> We are [names on slide]. Our project is called **Omnichannel Lead Management Platform**.
>
> It's for small businesses — like salons, tutors, photographers — who get customer messages on WhatsApp and Telegram but struggle to reply on time and track those customers.
>
> We have 8 weeks and 3 people in the team. Today we'll show you the idea, how the system works, what tech we use, and ask you a few questions at the end.

---

## SLIDE 2 — The Problem (about 1 minute)

> So what's the problem?
>
> Small shop owners get messages everywhere — WhatsApp, Telegram, web forms — but nothing is in one place.
>
> Messages get missed. Someone asks about prices at night, nobody replies, and they go somewhere else.
>
> There's no easy way to track who asked, who replied, who actually booked.
>
> Big CRM tools exist, but they're too expensive and too hard for a small salon owner.
>
> So we want to build something **simple and cheap** for small businesses.

---

## SLIDE 3 — Our Solution (about 1–2 minutes)

> Our idea is simple.
>
> **All messages come into one dashboard.** The owner or staff can see everything in one place.
>
> If nobody is online, a **chatbot can reply automatically** — like answering price questions at night.
>
> If the customer needs a real person, an **agent takes over** from the same dashboard.
>
> We also **track leads** — who asked, how interested they are — and we can **book appointments**.
>
> One example: a salon gets a WhatsApp message at 9 PM asking about haircut prices. The bot replies with packages. A lead is saved. Next morning the staff opens the app, sees the customer, and follows up. That's basically what we're building.
>
> Important point: the chatbot is a **separate part** of the system. If the bot is off, manual replies still work.

---

## SLIDE 4 — Architecture (about 2–3 minutes) ⭐ Know this well

> This is how the system is built. We split it into small services — each one does one job.
>
> **Step 1:** Customer sends a message on WhatsApp or Telegram.
>
> **Step 2:** **Messaging Gateway** gets it first. It saves the message and sends replies back. Think of it as the main door — everything goes through here.
>
> **Step 3:** Gateway asks **Routing Service** — "what kind of message is this?" We use **Google Gemini AI** for that. Is it about prices? Booking? Or they want a human?
>
> **Step 4:** Based on that, it goes to the right place:
> - **Chatbot** — auto reply  
> - **Lead Manager** — save and track the customer  
> - **Appointment Service** — booking  
>
> **Step 5:** **Notification Service** sends email or SMS to the staff — "you have a new customer."
>
> **Step 6:** **Web Dashboard** shows everything live. The agent sees new messages and leads without refreshing the page.
>
> When the agent replies, it goes back through the Gateway to the customer on WhatsApp or Telegram.
>
> So **Gateway runs the whole flow** — it calls other services one by one. We use simple HTTP calls, not a big message queue, because it's easier for us to build and test in 8 weeks.

---

## SLIDE 5 — Each Service (about 1–2 minutes)

> Quick summary of each part:
>
> **Messaging Gateway** — gets messages in, sends messages out, live updates to dashboard.
>
> **Routing** — figures out what the customer wants using AI.
>
> **Lead Manager** — keeps track of customers. Creates a lead, gives a score, shows status like new / contacted / booked. The agent doesn't chat through this — they use the dashboard. Lead Manager is just the record book.
>
> **Chatbot Builder** — runs ready-made conversation flows for salon, tutor, etc. No coding needed for the business owner.
>
> **Notification** — emails and SMS when something important happens.
>
> **Appointment** — check free slots, book, send reminders.
>
> **Web Dashboard** — what the agent and owner actually see and use.

---

## SLIDE 6 — Tech Stack (about 1 minute)

> For technology we picked things that are free and easy for students.
>
> **Backend:** Bun and Elysia.js with TypeScript. Elysia is light and fast — good for small APIs.
>
> **Database:** SQLite — no need to install a big database server. Each service has its own file.
>
> **Frontend:** Vue 3 for the dashboard.
>
> **AI:** Gemini — only to understand what the message is about. The chatbot itself uses fixed flows, not free chat AI.
>
> **Channels:** Telegram first for demo because it's easier to set up. WhatsApp later if we have time.
>
> **Deploy:** Docker Compose — run everything with one command.

---

## SLIDE 7 — Team & Timeline (about 1 minute)

> We split the work like this:
>
> **Person 1 (PANKAJA)** — Gateway and Routing (messages + AI routing)  
> **Person 2 (PADMASIRI)** — Lead Manager and Chatbot (tracking + auto replies)  
> **Person 3 (PATHIRANA)** — Dashboard, Notifications, Appointments (UI + email + booking)
>
> **Weeks 1–2:** setup, get basic services running  
> **Weeks 3–4:** build main features  
> **Weeks 5–6:** connect everything together  
> **Weeks 7–8:** fix bugs, docs, prepare demo
>
> Demo plan: customer messages → bot replies → lead shows up → agent replies → appointment booked.

---

## SLIDE 8 — Questions (about 1 minute)

> We have a few questions for you:
>
> 1. Is a **backend monorepo** (5 services) + separate chatbot + dashboard okay?
> 2. Is **Telegram enough** for the demo, or do we need WhatsApp for final submission?
> 3. The spec mentions a **mobile app** — is a **mobile-friendly website** okay instead?
> 4. Anything special you want for **documentation or diagrams** at mid-review?
>
> Thank you. Happy to answer anything or explain the diagram again.

---

## If mentor asks questions (simple answers)

**"What does Lead Manager do?"**  
> It saves customer info — who messaged, how hot the lead is, new or contacted or booked. Staff see it on the dashboard.

**"How does the agent talk to the customer?"**  
> Through the dashboard. Dashboard sends the reply to Gateway, Gateway sends it to WhatsApp or Telegram. Lead Manager just updates the status after.

**"Why so many services?"**  
> Three of us work at the same time without stepping on each other. Each part has one clear job.

**"Why Elysia / Bun?"**  
> TypeScript everywhere, fast, simple setup for many small APIs. Good for a student project.

**"Why Gemini?"**  
> Free tier, good enough to guess if someone wants prices vs booking. We don't need fancy AI chat.

---

## Short version (if time is tight — 2 minutes)

> We're building one inbox for small businesses — WhatsApp, Telegram, web — with optional chatbot and lead tracking. Messages hit the Gateway, AI routing picks the right handler, Lead Manager tracks customers, agents use a Vue dashboard. Backend monorepo + separate chatbot and dashboard. Bun, Elysia, SQLite, Docker. Three people. Telegram demo first. We have four scope questions for you.

---

## One sentence to remember

> **Customer messages the Gateway → AI picks what they want → bot or lead or booking handles it → staff see it live on the dashboard.**

Say that slowly while pointing at the architecture slide if you get stuck.

---

*Practice out loud once. Use simple words. It's okay to pause and look at the slide.*
