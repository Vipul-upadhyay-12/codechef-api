# CodeChef Scraper Microservice API

A high-performance, serverless Node.js microservice deployed on Vercel designed to bypass aggressive Cloudflare Turnstile bot challenges and CORS restrictions on CodeChef. It aggregates user statistics, rating trajectories, solve histories, and live upcoming contest schedules for competitive programming platforms.

---

## Features
- **Universal CORS Enabled**: Direct, unblocked client calls from Flutter Web, Android, iOS, and desktop clients.
- **Bot Bypass Headers**: Modern browser fingerprinting to evade Cloudflare 403 blocks.
- **Edge Caching**: Configured with `s-maxage` and `stale-while-revalidate` headers to minimize cold-start times and prevent IP blacklisting.
- **Live Contests Feed**: Aggregates ongoing and future CodeChef rounds directly from internal endpoints without third-party scrapers.

---

## API Endpoints

### 1. User Profile & Solves
`GET /handle/:username` or `GET /api?handle=:username`

#### Sample Response:
```json
{
  "success": true,
  "handle": "dank_ladka",
  "currentRating": 1346,
  "highestRating": 1346,
  "stars": 1,
  "globalRank": 57579,
  "countryRank": 54947,
  "totalSolved": 37,
  "ratingData": [
    {
      "code": "START254D",
      "name": "Starters 254 (Rated)",
      "rating": 1054,
      "rank": 8563,
      "year": 2026,
      "month": 9,
      "day": 2,
      "end_date": "2026-09-02 22:00:06"
    }
  ],
  "heatMap": [
    {
      "date": "2026-09-02",
      "value": 4
    }
  ],
  "solvedProblems": [
    {
      "code": "START261D",
      "name": "Starters 261 (Rated)",
      "solvedAt": "2026-10-21"
    }
  ]
}