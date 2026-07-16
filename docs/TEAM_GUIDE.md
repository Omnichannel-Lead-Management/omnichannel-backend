# Team Collaboration Guide
## Omnichannel Lead Management Platform

Guide for working effectively as a team of 3 on this semester project.

---

## Team Structure

### Recommended Division of Work

#### **Member 1: Messaging & Routing**
**Services:** Messaging Gateway + Routing Service

**Responsibilities:**
- Setup webhook receivers for WhatsApp/Telegram
- Implement platform adapters
- Integrate Google Gemini AI for intent detection
- Handle WebSocket for real-time updates
- Message persistence in database

**Skills Focus:**
- API integration (WhatsApp, Telegram)
- WebSocket programming
- AI/ML integration (Gemini)
- Real-time systems

**Estimated Workload:** ~40%

---

#### **Member 2: Business Logic & AI**
**Services:** Lead Manager + Chatbot Builder

**Responsibilities:**
- Implement lead CRUD operations
- Design lead scoring algorithm
- Build chatbot flow execution engine
- Create chatbot templates for different sectors
- Lead assignment logic

**Skills Focus:**
- Business logic design
- Algorithm implementation (scoring)
- Flow engine / state machine
- Database design

**Estimated Workload:** ~35%

---

#### **Member 3: Frontend & Support Services**
**Services:** Web Dashboard + Notification Service + Appointment Service

**Responsibilities:**
- Build Vue.js dashboard UI
- Real-time agent console
- Email/SMS notification system
- Appointment scheduling logic
- Analytics and reporting

**Skills Focus:**
- Vue 3 / Frontend development
- UI/UX design
- Email/SMS integration
- Calendar/scheduling logic

**Estimated Workload:** ~35%

---

## Weekly Schedule

### Week 1-2: Setup & Planning
**All Members:**
- [ ] Setup development environment
- [ ] Read all documentation (README, ARCHITECTURE, SETUP_GUIDE)
- [ ] Understand overall system architecture
- [ ] Create GitHub repository
- [ ] Setup branch strategy
- [ ] Decide on communication tools (Discord, Slack, WhatsApp group)

**Member 1:**
- [ ] Setup Messaging Gateway skeleton
- [ ] Get Telegram Bot Token
- [ ] Test basic webhook receiving

**Member 2:**
- [ ] Setup Lead Manager skeleton
- [ ] Design database schema
- [ ] Design lead scoring algorithm on paper

**Member 3:**
- [ ] Setup Web Dashboard skeleton
- [ ] Design UI wireframes
- [ ] Setup Pinia stores

**Meeting:** End of Week 2 - Demo basic setup

---

### Week 3-4: Core Features
**Member 1:**
- [ ] Implement WhatsApp webhook handler
- [ ] Implement Telegram webhook handler
- [ ] Integrate with Routing Service
- [ ] Store messages in database
- [ ] Send responses back to platforms

**Member 2:**
- [ ] Implement Lead CRUD API
- [ ] Implement lead scoring logic
- [ ] Create basic chatbot flow executor
- [ ] Integrate with Messaging Gateway

**Member 3:**
- [ ] Build login page
- [ ] Build agent console UI
- [ ] Implement WebSocket connection
- [ ] Build lead list view
- [ ] Setup SMTP for notifications

**Meeting:** End of Week 4 - Demo core features working end-to-end

---

### Week 5-6: Integration & Polish
**Member 1:**
- [ ] Add voice message support (optional)
- [ ] Improve error handling
- [ ] Add request logging
- [ ] Implement rate limiting

**Member 2:**
- [ ] Create chatbot templates (salon, tutor, photographer)
- [ ] Implement lead assignment logic
- [ ] Add lead activity tracking
- [ ] Build lead analytics

**Member 3:**
- [ ] Implement appointment scheduling UI
- [ ] Build analytics dashboard
- [ ] Add charts and graphs
- [ ] Implement notification templates
- [ ] Polish UI/UX

**Meeting:** End of Week 6 - Integration testing

---

### Week 7-8: Testing & Presentation
**All Members:**
- [ ] Full end-to-end testing
- [ ] Bug fixes
- [ ] Write final documentation
- [ ] Prepare demo
- [ ] Create presentation slides
- [ ] Practice demo
- [ ] Deploy to cloud (optional)

**Meeting:** Multiple - Daily standups for bug fixes

---

## Git Workflow

### Branch Strategy

```
main (protected - only merge from develop)
  └── develop (main development branch)
       ├── feature/messaging-gateway
       ├── feature/routing-service
       ├── feature/lead-manager
       ├── feature/chatbot-builder
       ├── feature/web-dashboard
       └── feature/notifications
```

### Workflow Steps

1. **Create Feature Branch**
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   ```bash
   # Write code
   # Test locally
   git add .
   git commit -m "Add feature X"
   ```

3. **Push to Remote**
   ```bash
   git push origin feature/your-feature-name
   ```

4. **Create Pull Request**
   - Go to GitHub
   - Click "New Pull Request"
   - Base: develop ← Compare: feature/your-feature-name
   - Add description
   - Request review from team members

5. **Code Review**
   - Team members review
   - Leave comments
   - Request changes if needed

6. **Merge**
   - After approval, merge to develop
   - Delete feature branch

---

### Commit Message Format

Follow this format for consistency:

```
<type>(<scope>): <subject>

<body> (optional)

Examples:
feat(lead-manager): Add lead scoring algorithm
fix(messaging): Fix WhatsApp webhook signature verification
docs(readme): Update setup instructions
refactor(chatbot): Simplify flow execution logic
test(routing): Add unit tests for intent classifier
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks

---

## Communication

### Daily Standup (15 minutes)

**When:** Every day at 10:00 AM (or convenient time)
**Format:** Voice/video call or text update

**Each member answers 3 questions:**
1. What did I complete yesterday?
2. What will I work on today?
3. Any blockers or help needed?

**Example:**
```
Member 1:
✅ Yesterday: Implemented WhatsApp webhook, stored messages in DB
🎯 Today: Integrate with Routing Service
❌ Blockers: Need Gemini API key from Member 2
```

---

### Weekly Team Meeting (1 hour)

**When:** Every Sunday 2:00 PM
**Agenda:**
1. Demo what each person built this week
2. Discuss integration points
3. Plan next week's tasks
4. Address blockers
5. Update project timeline

**Format:** Video call with screen sharing

---

### Communication Channels

**Primary:** WhatsApp Group / Discord Server
**For:** Quick questions, updates, coordination

**Secondary:** GitHub Issues
**For:** Bug tracking, feature requests, task assignment

**Documentation:** This repository
**For:** Technical documentation, API specs, guides

---

## Coding Standards

### TypeScript

```typescript
// ✅ GOOD
interface Lead {
  id: string;
  businessId: string;
  messengerId: string;
  platform: Platform;
  status: LeadStatus;
  score: number;
}

async function createLead(data: CreateLeadDto): Promise<Lead> {
  // Implementation
}

// ❌ BAD
function createLead(data: any): any {
  // No types = hard to maintain
}
```

---

### File Naming

```
// Services
user.service.ts
lead.service.ts

// Controllers
user.controller.ts
lead.controller.ts

// Models
user.model.ts
lead.model.ts

// Types
platform.types.ts
message.types.ts

// Components (Vue)
UserProfile.vue
LeadList.vue
```

---

### Code Comments

```typescript
// ✅ GOOD - Explain WHY, not WHAT
// Calculate score based on engagement, source, and timing
// Higher score = more likely to convert
function calculateLeadScore(lead: Lead): number {
  let score = 30; // Base score

  // WhatsApp leads convert 2x better than web
  if (lead.platform === 'whatsapp') score += 10;

  return score;
}

// ❌ BAD - Comments state the obvious
// This function calculates lead score
function calculateLeadScore(lead: Lead): number {
  let score = 30; // Set score to 30
  score += 10; // Add 10 to score
  return score; // Return the score
}
```

---

## Integration Points

### Between Member 1 & Member 2

**Messaging Gateway → Routing Service → Lead Manager**

**Contract:**
```typescript
// Member 1 sends to Member 2's routing service
POST http://routing-service:3001/route
{
  "message": "What are your prices?",
  "businessId": "biz_001",
  "messengerId": "1234567890"
}

// Member 2 returns intent
{
  "intent": "service_inquiry",
  "service": "chatbot-builder"
}
```

**Testing Together:**
```bash
# Member 2 starts routing service
cd routing-service
bun run dev

# Member 1 tests from messaging gateway
curl -X POST http://localhost:3001/route \
  -d '{"message": "hello", "businessId": "biz_001"}'
```

---

### Between Member 2 & Member 3

**Lead Manager → Web Dashboard**

**Contract:**
```typescript
// Member 3 calls Member 2's lead API
GET http://localhost:3002/api/leads?businessId=biz_001

// Member 2 returns leads
{
  "leads": [{ "id": "lead_123", ... }]
}
```

**Testing Together:**
```bash
# Member 2 creates test lead
curl -X POST http://localhost:3002/api/leads \
  -d '{"businessId": "biz_001", ...}'

# Member 3 fetches from dashboard
# Should see the lead appear in UI
```

---

### Between Member 1 & Member 3

**Messaging Gateway WebSocket → Web Dashboard**

**Contract:**
```typescript
// Member 1 broadcasts events
ws.send(JSON.stringify({
  type: "new_lead",
  data: { leadId: "lead_123", ... }
}))

// Member 3 listens in dashboard
ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'new_lead') {
    // Update UI
  }
});
```

---

## Testing Strategy

### Unit Tests
Each member writes unit tests for their own code.

```typescript
// lead-manager/tests/scoring.test.ts
import { describe, it, expect } from 'bun:test';
import { calculateLeadScore } from '../src/services/scoring';

describe('Lead Scoring', () => {
  it('should give higher score to WhatsApp leads', () => {
    const lead = {
      platform: 'whatsapp',
      // ... other fields
    };

    const score = calculateLeadScore(lead);
    expect(score).toBeGreaterThan(30);
  });
});
```

Run tests:
```bash
bun test
```

---

### Integration Tests
Test together as a team.

**Scenario 1: End-to-End Message Flow**
1. Member 1: Send test WhatsApp message
2. Member 2: Verify intent detected correctly
3. Member 2: Verify lead created
4. Member 3: Verify lead appears in dashboard

**Scenario 2: Agent Reply**
1. Member 3: Agent sends reply from dashboard
2. Member 1: Verify message sent to WhatsApp
3. Member 2: Verify lead status updated

---

## Handling Conflicts

### Code Conflicts

When git merge conflicts occur:

1. **Communicate:** Tell team member there's a conflict
2. **Review:** Look at both versions
3. **Discuss:** Video call if needed
4. **Resolve:** Keep the better version or merge both
5. **Test:** Make sure nothing broke

```bash
# When you see conflict
git status
# Shows conflicted files

# Open file, look for:
<<<<<<< HEAD
Your code
=======
Their code
>>>>>>> branch-name

# Edit to keep what you need
# Remove conflict markers
git add .
git commit
```

---

### Disagreements

**Technical Disagreements:**
1. Each person explains their approach
2. List pros/cons of each
3. Vote or ask mentor for advice
4. Document decision in README

**Example:**
```markdown
## Decision Log

### Lead Scoring Algorithm
**Date:** 2024-04-15
**Decision:** Use weighted scoring based on platform, timing, and engagement
**Alternatives Considered:** Simple rule-based, ML model
**Reasoning:** Weighted scoring is simple, explainable, and sufficient for MVP
**Decided By:** Team vote (3-0)
```

---

## Demo Preparation

### 2 Weeks Before

- [ ] All core features complete
- [ ] Basic testing done
- [ ] No major bugs

### 1 Week Before

- [ ] Create demo script
- [ ] Prepare sample data
- [ ] Create presentation slides
- [ ] Practice demo (dry run)

### Demo Day

**Demo Script:**
1. **Introduction** (1 min)
   - Team members
   - Project overview

2. **Problem Statement** (1 min)
   - What problem are we solving?
   - Who is it for?

3. **Live Demo** (5-7 min)
   - Show customer sending WhatsApp message
   - Show AI routing
   - Show chatbot responding
   - Show agent dashboard
   - Show lead management
   - Show appointment booking

4. **Architecture** (2 min)
   - Show system diagram
   - Explain microservices
   - Highlight key technologies

5. **Challenges & Learnings** (1 min)
   - What was hardest?
   - What did you learn?

6. **Q&A** (2 min)

**Total:** 12-15 minutes

---

## Backup Plans

### What If Someone Gets Sick?

**Before Week 4:**
- Other members pick up remaining tasks
- Simplify scope if needed

**After Week 4:**
- Focus on fixing bugs in existing code
- Other members help with documentation

---

### What If Feature Is Too Complex?

**Reduce Scope:**
- ✅ Keep: Core message flow, basic chatbot, lead list
- ❌ Cut: Voice messages, advanced analytics, multiple platforms

**Fallback Features:**
- Instead of 3 platforms → Focus on 1 (Telegram is easiest)
- Instead of advanced chatbot → Simple keyword matching
- Instead of complex UI → Basic functional UI

---

## Tips for Success

### For All Members

1. **Start Early:** Don't wait until last minute
2. **Communicate Often:** Daily updates prevent surprises
3. **Test Locally:** Test your code before pushing
4. **Write Docs:** Document as you code, not at the end
5. **Ask for Help:** Stuck for >30min? Ask team or mentor
6. **Review Code:** Look at each other's code, learn together
7. **Celebrate Wins:** When something works, celebrate!

### For Member 1 (Messaging & Routing)

- **Start with Telegram:** Easier than WhatsApp to test
- **Use ngrok:** For webhook testing (https://ngrok.com)
- **Test with Mock Data:** Don't wait for Gemini API
- **Log Everything:** console.log all webhook payloads

### For Member 2 (Lead Manager & Chatbot)

- **Design Database First:** Clear schema prevents rework
- **Start Simple:** Basic scoring before complex algorithm
- **Test with Postman:** Test APIs before integration
- **Document Scoring Logic:** Team needs to understand it

### For Member 3 (Web Dashboard & Services)

- **Design UI First:** Sketch layouts before coding
- **Use Dummy Data:** Don't wait for backend APIs
- **Mobile Responsive:** Make it work on small screens
- **User Friendly:** Think like an agent using the app

---

## Emergency Contacts

**Team Members:**
- Member 1: [Name] - [Phone] - [Email]
- Member 2: [Name] - [Phone] - [Email]
- Member 3: [Name] - [Phone] - [Email]

**Mentor/Professor:**
- Name: [Mentor Name]
- Email: [Mentor Email]
- Office Hours: [Time]

**Group Chat:**
- WhatsApp Group / Discord Server

---

## Success Metrics

Track progress weekly:

| Week | Target | Status |
|------|--------|--------|
| 1-2 | Setup complete | ⏳ |
| 3-4 | Core features working | ⏳ |
| 5-6 | Integration complete | ⏳ |
| 7-8 | Demo ready | ⏳ |

**Final Goal:**
- ✅ Working end-to-end demo
- ✅ All team members understand entire system
- ✅ Clean, documented code
- ✅ Successful presentation

---

## Retrospective (End of Project)

After completing the project, team meeting to discuss:

1. **What went well?**
   - What should we keep doing?

2. **What could be improved?**
   - What should we do differently?

3. **What did we learn?**
   - Technical skills
   - Teamwork skills

4. **Celebrate!**
   - You built something amazing!

---

## Remember

- **Communication is key:** Talk to each other daily
- **Help each other:** You're a team, not competitors
- **It's a learning project:** Mistakes are okay
- **Have fun:** Building cool stuff should be enjoyable!

---

**You've got this! 🚀**

Good luck with your semester project!

*Created with ❤️ for your success*
