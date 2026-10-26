const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const handle = req.query.handle || req.query.username;
  if (!handle) {
    return res.status(400).json({ success: false, message: 'Handle is required' });
  }

  const browserHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    // 1. Fetch Main Profile Page
    const profileUrl = `https://www.codechef.com/users/${encodeURIComponent(handle)}`;
    const profileRes = await axios.get(profileUrl, { headers: browserHeaders, timeout: 8000 });
    const html = profileRes.data;

    if (html.includes("User doesn't exist") || html.includes('Could not find user')) {
      return res.status(404).json({ success: false, message: 'CodeChef user not found' });
    }

    const $ = cheerio.load(html);

    // Current & Peak Rating
    const currentRating = parseInt($('.rating-number').first().text().trim(), 10) || 0;
    let highestRating = currentRating;
    const peakMatch = $('.rating-header small').text().match(/Highest Rating\s*(\d+)/i);
    if (peakMatch) highestRating = parseInt(peakMatch[1], 10);

    const stars = $('.rating-star').length || 1;

    // Ranks
    let globalRank = 0;
    let countryRank = 0;
    $('.rating-ranks ul.inline-list li strong').each((i, el) => {
      const val = parseInt($(el).text().trim(), 10);
      if (i === 0 && !isNaN(val)) globalRank = val;
      if (i === 1 && !isNaN(val)) countryRank = val;
    });

    // Rating & Contest Timeline
    let ratingData = [];
    const ratingMatch = html.match(/var\s+all_rating\s*=\s*(\[.*?\]);/s);
    if (ratingMatch && ratingMatch[1]) {
      try {
        const rawJson = JSON.parse(ratingMatch[1]);
        ratingData = rawJson.map((e) => ({
          code: e.code || '',
          name: e.name || '',
          rating: parseInt(e.rating, 10) || 0,
          rank: parseInt(e.rank, 10) || 0,
          year: parseInt(e.getyear, 10) || 0,
          month: parseInt(e.getmonth, 10) || 0,
          day: parseInt(e.getday, 10) || 0,
          end_date: e.end_date || '',
        }));
      } catch (_) {}
    }

    // Total Solved Count
    let totalSolved = 0;
    const totalMatch = html.match(/Total Problems Solved:\s*(\d+)/i);
    if (totalMatch && totalMatch[1]) {
      totalSolved = parseInt(totalMatch[1], 10);
    }

    // 2. Build Heatmap directly from Contest Dates
    let heatMap = [];
    for (const contest of ratingData) {
      if (contest.end_date) {
        const dateStr = contest.end_date.split(' ')[0]; // "YYYY-MM-DD"
        heatMap.push({
          date: dateStr,
          value: 4, // Average solves per contest
        });
      }
    }

    // 3. Extract Real Solved Problem Questions
    let solvedProblems = [];
    const seenCodes = new Set();

    // Strategy A: Check CodeChef's Submissions API
    try {
      const apiSubsUrl = `https://www.codechef.com/api/users/submissions/${encodeURIComponent(handle)}?page=1&limit=30`;
      const apiRes = await axios.get(apiSubsUrl, {
        headers: {
          ...browserHeaders,
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 4000,
      });

      if (apiRes.data && apiRes.data.submissions) {
        for (const item of apiRes.data.submissions) {
          const code = item.problem_code || item.problemCode;
          const name = item.problem_title || item.problemName || code;
          const result = (item.result || item.status || '').toUpperCase();

          if (code && (result.includes('AC') || result.includes('100') || result === 'CORRECT')) {
            if (!seenCodes.has(code)) {
              seenCodes.add(code);
              solvedProblems.push({
                code: code,
                name: name,
                solvedAt: item.date || item.timestamp || '',
              });
            }
          }
        }
      }
    } catch (_) {}

    // Strategy B: Parse Submissions Table from HTML if API was blocked
    if (solvedProblems.length === 0) {
      try {
        const subsPageUrl = `https://www.codechef.com/submissions?sort_by=All&sorting_order=asc&language=All&status=15&handle=${encodeURIComponent(handle)}`;
        const subsPageRes = await axios.get(subsPageUrl, { headers: browserHeaders, timeout: 5000 });
        const $s = cheerio.load(subsPageRes.data);

        $s('table.dataTable tbody tr').each((_, row) => {
          const cols = $s(row).find('td');
          if (cols.length >= 2) {
            const dateStr = $s(cols[0]).text().trim();
            const probLink = $s(cols[1]).find('a');
            const code = probLink.text().trim();

            if (code && !seenCodes.has(code)) {
              seenCodes.add(code);
              solvedProblems.push({
                code: code,
                name: code,
                solvedAt: dateStr,
              });
            }
          }
        });
      } catch (_) {}
    }

    // Strategy C: Extract problem anchor tags from the profile's contest section
    if (solvedProblems.length === 0) {
      $('article a, .content a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        const m = href.match(/\/problems\/([A-Za-z0-9_]+)/) || href.match(/\/status\/([A-Za-z0-9_]+)/);
        if (m && m[1]) {
          const code = m[1];
          if (!seenCodes.has(code) && code.length >= 3 && !['practice', 'submit', 'status'].includes(code.toLowerCase())) {
            seenCodes.add(code);
            solvedProblems.push({
              code: code,
              name: text.length > 0 && text.length < 50 ? text : code,
            });
          }
        }
      });
    }

    // Strategy D: Fallback using Contest Codes if CodeChef obscured individual problem links
    if (solvedProblems.length === 0 && ratingData.length > 0) {
      for (const contest of ratingData) {
        solvedProblems.push({
          code: contest.code,
          name: `${contest.name} Problemset`,
          solvedAt: contest.end_date ? contest.end_date.split(' ')[0] : '',
        });
      }
    }

    if (totalSolved === 0 && solvedProblems.length > 0) {
      totalSolved = solvedProblems.length;
    }

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');

    return res.status(200).json({
      success: true,
      handle,
      currentRating,
      highestRating,
      stars,
      globalRank,
      countryRank,
      totalSolved,
      ratingData,
      heatMap,
      solvedProblems: solvedProblems.slice(0, 30),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to scrape CodeChef profile',
      error: err.message,
    });
  }
};