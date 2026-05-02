# Notification System Design

## Stage 1

### REST API Design for Campus Notification Platform

#### Core Endpoints

**Get all notifications for a user**
```
GET /api/notifications
Headers:
  Authorization: Bearer <token>
  Content-Type: application/json

Response 200:
{
  "notifications": [
    {
      "id": "uuid",
      "type": "Placement" | "Event" | "Result",
      "message": "string",
      "isRead": false,
      "timestamp": "2026-04-22T17:51:30Z"
    }
  ],
  "total": 100,
  "page": 1,
  "pageSize": 20
}
```

**Mark notification as read**
```
PATCH /api/notifications/:id/read
Headers:
  Authorization: Bearer <token>

Response 200:
{
  "id": "uuid",
  "isRead": true
}
```

**Mark all notifications as read**
```
PATCH /api/notifications/read-all
Headers:
  Authorization: Bearer <token>

Response 200:
{
  "updated": 45
}
```

**Get unread notification count**
```
GET /api/notifications/unread-count
Headers:
  Authorization: Bearer <token>

Response 200:
{
  "count": 12
}
```

**Send notification (admin only)**
```
POST /api/notifications
Headers:
  Authorization: Bearer <token>
  Content-Type: application/json

Request Body:
{
  "type": "Placement",
  "message": "TCS hiring drive on May 10",
  "targetStudentIds": ["uuid1", "uuid2"] // empty = all students
}

Response 201:
{
  "id": "uuid",
  "type": "Placement",
  "message": "TCS hiring drive on May 10",
  "timestamp": "2026-05-02T10:00:00Z"
}
```

#### Real-time Notification Mechanism

Use **WebSockets** (via Socket.IO) for real-time delivery:
- On login, client connects to WebSocket server with auth token
- Server maps `studentId → socket connection`
- On new notification, server emits to the student's socket
- Fallback: polling `GET /api/notifications` every 30 seconds if WebSocket disconnects

---

## Stage 2

### Database Choice: PostgreSQL

**Why PostgreSQL:**
- Structured relational data (students, notifications) fits SQL well
- Strong support for indexing, joins, and transactions
- ENUM types natively supported for notification types
- Scales well with proper indexing and partitioning

### DB Schema

```sql
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  roll_no VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TYPE notification_type AS ENUM ('Placement', 'Event', 'Result');

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type notification_type NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE student_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_student_notifications_student_id ON student_notifications(student_id);
CREATE INDEX idx_student_notifications_is_read ON student_notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
```

### Problems at Scale and Solutions

As data grows to 50,000 students and 5,000,000 notifications:

**Problem 1 — Table size:** `student_notifications` will have millions of rows.
**Solution:** Partition the table by `created_at` (monthly partitions).

**Problem 2 — Slow unread queries:** Full table scans on `is_read = false`.
**Solution:** Partial index: `CREATE INDEX idx_unread ON student_notifications(student_id) WHERE is_read = FALSE;`

**Problem 3 — Fan-out on send:** Inserting 50,000 rows per broadcast is slow.
**Solution:** Use a message queue (Redis/BullMQ) to batch inserts asynchronously.

### SQL Queries

**Fetch unread notifications for a student:**
```sql
SELECT n.id, n.type, n.message, n.created_at, sn.is_read
FROM student_notifications sn
JOIN notifications n ON sn.notification_id = n.id
WHERE sn.student_id = $1 AND sn.is_read = FALSE
ORDER BY n.created_at DESC;
```

**Mark all as read for a student:**
```sql
UPDATE student_notifications
SET is_read = TRUE, read_at = NOW()
WHERE student_id = $1 AND is_read = FALSE;
```

---

## Stage 3

### Query Analysis

**Original query:**
```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

**Why is this slow?**
- No indexes on `studentID`, `isRead`, or `createdAt`
- `SELECT *` fetches all columns including large TEXT fields unnecessarily
- At 5,000,000 rows, a full table scan is O(n)

**Is indexing every column a good idea?**
No. Indexing every column is wasteful because:
- Each index increases storage and slows down INSERT/UPDATE operations
- Most columns are never used in WHERE clauses
- Composite indexes are more efficient than individual column indexes

**Optimized query:**
```sql
SELECT id, type, message, created_at
FROM student_notifications sn
JOIN notifications n ON sn.notification_id = n.id
WHERE sn.student_id = 1042 AND sn.is_read = FALSE
ORDER BY n.created_at DESC
LIMIT 50;
```

**Recommended index:**
```sql
CREATE INDEX idx_unread_by_student
ON student_notifications(student_id, is_read, created_at DESC)
WHERE is_read = FALSE;
```

**Find students who got a Placement notification in the last 7 days:**
```sql
SELECT DISTINCT s.id, s.name, s.email
FROM students s
JOIN student_notifications sn ON s.id = sn.student_id
JOIN notifications n ON sn.notification_id = n.id
WHERE n.type = 'Placement'
  AND n.created_at >= NOW() - INTERVAL '7 days';
```

---

## Stage 4

### Caching Strategy

**Problem:** DB is overwhelmed by fetching notifications on every page load for every student.

**Solution: Redis Cache with TTL**

**Strategy:**
- Cache each student's notification list in Redis with key `notifications:student:{id}`
- Set TTL of 60 seconds (short enough to stay fresh, long enough to reduce DB hits)
- Invalidate cache on new notification sent or when student reads a notification

**Implementation flow:**
1. Request comes in for student notifications
2. Check Redis for key `notifications:student:{studentId}`
3. Cache HIT → return cached data immediately (no DB call)
4. Cache MISS → query DB, store result in Redis with TTL, return data

**Tradeoffs:**

| Strategy | Pro | Con |
|---|---|---|
| Redis TTL (60s) | Simple, fast, low DB load | Data can be 60s stale |
| Cache invalidation on write | Always fresh | Complex, invalidation bugs |
| CDN caching | Great for static content | Not suitable for user-specific data |
| No cache (polling) | Always fresh | DB overwhelmed at scale |

**Recommended approach:** Redis TTL + invalidation on write events. The 60s staleness is acceptable for notifications; real-time delivery is handled by WebSockets anyway.

---

## Stage 5

### Bulk Notification Redesign

**Original pseudocode problems:**
```
function notify_all(student_ids, message):
  for student_id in student_ids:
    send_email(student_id, message)   # synchronous, blocks on failure
    save_to_db(student_id, message)   # coupled with email
    push_to_app(student_id, message)
```

**Shortcomings:**
- Synchronous loop over 50,000 students is extremely slow (O(n) sequential)
- If `send_email` fails at student 200, remaining 49,800 students are not notified
- DB insert and email send are tightly coupled — if email fails, DB rollback loses the record
- No retry mechanism for failed emails
- Blocking the main thread causes timeouts

**Redesigned approach using a Message Queue:**

```
function notify_all(student_ids, message):
  // Step 1: Save all notifications to DB in bulk (one query)
  bulk_insert_to_db(student_ids, message)

  // Step 2: Push all jobs to a queue
  for student_id in student_ids:
    queue.push({ student_id, message, type: "email" })
    queue.push({ student_id, message, type: "push" })

// Worker (runs separately, processes queue)
function worker():
  job = queue.pop()
  try:
    if job.type == "email":
      send_email(job.student_id, job.message)
    elif job.type == "push":
      push_to_app(job.student_id, job.message)
  catch error:
    queue.retry(job, max_retries=3)  // retry failed jobs
```

**Should DB save and email happen together?**
No. They should be decoupled:
- DB insert should happen first and always succeed (source of truth)
- Email is best-effort and should be retried independently via queue
- This ensures no notification is lost even if email service is down

---

## Stage 6

### Priority Inbox Implementation

**Approach:**
- Fetch all notifications from the provided API
- Score each notification based on type weight and recency
- Type weights: Placement = 3, Result = 2, Event = 1
- Recency score: newer notifications get higher score using time decay
- Final score = typeWeight * recencyFactor
- Sort by score descending, return top N

**How to maintain top 10 efficiently as new notifications arrive:**
- Use a Min-Heap of size N
- On new notification: compute score, if score > heap minimum, replace minimum
- This maintains top N in O(log N) time per insertion vs O(n log n) for full sort

See `notification_app_be/server.js` for the working implementation.
