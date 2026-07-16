# How to Create Mentor Meeting Slides

Three easy options — pick one.

---

## Option A: Google Slides (easiest, no install)

1. Go to [Google Slides](https://slides.google.com) → **Blank presentation**
2. Open `MENTOR_PRESENTATION.md` in this folder
3. Copy content **slide by slide** (each `---` block = one slide)
4. Add the architecture diagram:
   - Export from [mermaid.live](https://mermaid.live) using `diagrams/architecture.mmd`
   - Or screenshot the diagram from `PROJECT_PROPOSAL.pdf` after compiling LaTeX
5. Keep **6–8 slides**, large font (24pt+), minimal text per slide

**Tip:** Use speaker notes for details; slides should only have bullet points.

---

## Option B: Marp (Markdown → PDF/PPT)

[Marp](https://marp.app/) turns `MENTOR_PRESENTATION.md` into slides automatically.

### VS Code / Cursor
1. Install extension: **Marp for VS Code**
2. Open `MENTOR_PRESENTATION.md`
3. Click preview icon → **Export Slide Deck** → PDF or PPTX

### CLI
```bash
npm install -g @marp-team/marp-cli
cd /mnt/Files/omnichannel-workspace
marp MENTOR_PRESENTATION.md --pdf -o mentor-slides.pdf
# or
marp MENTOR_PRESENTATION.md --pptx -o mentor-slides.pptx
```

---

## Option C: PowerPoint / LibreOffice Impress

1. New presentation, **16:9** widescreen
2. Use this slide order:

| Slide | Title | Content |
|-------|-------|---------|
| 1 | Title | Project name, team names + index numbers, PID-1 |
| 2 | Problem | 3–4 bullets on pain points |
| 3 | Solution | One-line goal + salon example |
| 4 | Architecture | Diagram (draw.io or mermaid export) |
| 5 | Services | 7-row table (from slide 4 in MD file) |
| 6 | Tech stack | Backend / Frontend / AI / Deploy table |
| 7 | Team & timeline | Who builds what + 8-week plan |
| 8 | Questions | 3–4 questions for mentor |

---

## Design tips for mentor meeting

- **6–8 slides max** for a 10–15 minute meeting
- **One idea per slide**
- Use the **architecture diagram** on slide 4 — mentors care about structure
- Mention **demo scenario** verbally: WhatsApp/Telegram → chatbot → lead → agent → appointment
- End with **questions for mentor** — shows you planned the meeting
- Avoid paragraphs; use bullets only

---

## Files in this workspace

| File | Purpose |
|------|---------|
| `MENTOR_PRESENTATION.md` | Ready-made slide content (Marp format) |
| `diagrams/architecture.mmd` | Architecture diagram source |
| `PROJECT_PROPOSAL.tex` | Has TikZ architecture diagram (compile to PDF) |
| `omnichannel-backend/docs/ARCHITECTURE.md` | Full technical detail if mentor asks |

---

## Suggested meeting flow (10 min)

1. **2 min** — Problem + solution (slides 1–3)
2. **3 min** — Architecture walkthrough (slides 4–5)
3. **2 min** — Tech stack + team split (slides 6–7)
4. **3 min** — Questions and mentor feedback (slide 8)
