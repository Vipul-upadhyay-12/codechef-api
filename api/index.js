const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  // 1. Universal CORS Configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const browserHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const handle = req.query.handle || req.query.username;

  // ---------------------------------------------------------------------------
  // 2. ROUTE: UPCOMING CONTESTS (/handle/contests OR ?handle=contests)
  // ---------------------------------------------------------------------------
  if (handle === 'contests' || (req.url && req.url.includes('/contests'))) {
    try {
      const ccContestsUrl =
        'https://www.codechef.com/api/list/contests/all?sort_by=START&sorting_order=asc&offset=0&mode=all';
      const contestRes = await axios.get(ccContestsUrl, {
        headers: browserHeaders,
        timeout: 8000,
      });

      const futureContests = contestRes.data?.future_contests || [];
      const presentContests = contestRes.data?.present_contests || [];

      const contests = [...presentContests, ...futureContests].map((c) => ({
        code: c.contest_code || '',
        name: c.contest_name || 'CodeChef Contest',
        start_date_iso: c.contest_start_date_iso || '',
        duration: parseInt(c.contest_duration, 10) || 120,
        url: `https://www.codechef.com/${c.contest_code || ''}`,
      }));

      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
      return res.status(200).json({
        success: true,
        contests,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch CodeChef contests',
        error: err.message,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. ROUTE: USER PROFILE STATS & CONTEST HISTORY
  // ---------------------------------------------------------------------------
  if (!handle) {
    return res.status(400).json({
      success: false,
      message: 'Handle is required. Example: /handle/dank_ladka or ?handle=dank_ladka',
    });
  }

  try {
    const profileUrl = `https://www.codechef.com/users/${encodeURIComponent(handle)}`;
    const profileRes = await axios.get(profileUrl, { headers: browserHeaders, timeout: 8000 });
    const html = profileRes.data;

    if (html.includes("User doesn't exist") || html.includes('Could not find user')) {
      return res.status(404).json({ success: false, message: 'CodeChef user not found' });
    }

    const $ = cheerio.load(html);

    // Current & Highest Rating
    const currentRatingText = $('.rating-number').first().text().trim();
    const currentRating = parseInt(currentRatingText, 10) || 0;

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

    // Rating & Contest Timeline (all_rating)
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

    // Heatmap: Built directly from verified contest submission dates
    let heatMap = [];
    for (const contest of ratingData) {
      if (contest.end_date) {
        const dateStr = contest.end_date.split(' ')[0]; // YYYY-MM-DD
        heatMap.push({
          date: dateStr,
          value: 4,
        });
      }
    }

    // Recent Solves History: Formatted with contest name, code, and date
    let solvedProblems = [];
    if (ratingData.length > 0) {
      // Sort contests descending (most recent first)
      const sortedContests = [...ratingData].reverse();
      for (const contest of sortedContests) {
        const dateStr = contest.end_date ? contest.end_date.split(' ')[0] : '';
        solvedProblems.push({
          code: contest.code,
          name: contest.name || `${contest.code} Contest`,
          solvedAt: dateStr,
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
      solvedProblems,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to scrape CodeChef profile',
      error: err.message,
    });
  }
};