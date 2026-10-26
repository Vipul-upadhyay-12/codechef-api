const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const handle = req.query.handle || req.query.username;
  if (!handle) {
    return res.status(400).json({ success: false, message: 'Handle is required' });
  }

  try {
    const targetUrl = `https://www.codechef.com/users/${encodeURIComponent(handle)}`;

    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 8000,
    });

    const html = response.data;
    if (html.includes("User doesn't exist") || html.includes('Could not find user')) {
      return res.status(404).json({ success: false, message: 'CodeChef user not found' });
    }

    const $ = cheerio.load(html);

    // 1. Current Rating & Peak Rating
    const currentRatingText = $('.rating-number').first().text().trim();
    const currentRating = parseInt(currentRatingText, 10) || 0;

    let highestRating = currentRating;
    const ratingHeaderSmall = $('.rating-header small').text();
    const peakMatch = ratingHeaderSmall.match(/Highest Rating\s*(\d+)/i);
    if (peakMatch) highestRating = parseInt(peakMatch[1], 10);

    const stars = $('.rating-star').length;

    // 2. Global & Country Rank
    let globalRank = 0;
    let countryRank = 0;
    $('.rating-ranks ul.inline-list li strong').each((i, el) => {
      const val = parseInt($(el).text().trim(), 10);
      if (i === 0 && !isNaN(val)) globalRank = val;
      if (i === 1 && !isNaN(val)) countryRank = val;
    });

    // 3. Rating History (all_rating JS array)
    let ratingData = [];
    const scriptMatches = html.match(/var\s+all_rating\s*=\s*(\[.*?\]);/s);
    if (scriptMatches && scriptMatches[1]) {
      try {
        const rawJson = JSON.parse(scriptMatches[1]);
        ratingData = rawJson.map((entry) => ({
          code: entry.code || '',
          name: entry.name || '',
          rating: parseInt(entry.rating, 10) || 0,
          rank: parseInt(entry.rank, 10) || 0,
          year: parseInt(entry.getyear, 10) || 0,
          month: parseInt(entry.getmonth, 10) || 0,
          day: parseInt(entry.getday, 10) || 0,
          end_date: entry.end_date || '',
        }));
      } catch (_) {}
    }

    // 4. Heatmap Activity (userDailySubmissions JS array)
    let heatMap = [];
    const heatMapMatch = html.match(/var\s+userDailySubmissions\s*=\s*(\[.*?\]);/s);
    if (heatMapMatch && heatMapMatch[1]) {
      try {
        heatMap = JSON.parse(heatMapMatch[1]);
      } catch (_) {}
    }

    // 5. Total Problems Solved Extraction
    let totalSolved = 0;
    let solvedProblems = [];
    const seenProblems = new Set();

    // Strategy A: Regex match on modern "Total Problems Solved: X" header
    const totalMatch = html.match(/Total Problems Solved:\s*(\d+)/i);
    if (totalMatch && totalMatch[1]) {
      totalSolved = parseInt(totalMatch[1], 10);
    }

    // Strategy B: Collect specific problem codes from contest & practice sections
    // Matches links pointing to: /status/PROBLEM,dank_ladka OR /problems/PROBLEM
    $('a[href*="/status/"], a[href*="/problems/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();

      const statusMatch = href.match(/\/status\/([A-Za-z0-9_]+),/);
      const probMatch = href.match(/\/problems\/([A-Za-z0-9_]+)/);

      const code = statusMatch ? statusMatch[1] : (probMatch ? probMatch[1] : null);

      if (
        code &&
        code.length > 2 &&
        !seenProblems.has(code) &&
        !['practice', 'submit', 'easy', 'medium', 'hard', 'challenge'].includes(code.toLowerCase())
      ) {
        seenProblems.add(code);
        solvedProblems.push({
          code: code,
          name: text.length > 0 && text.length < 50 ? text : code,
        });
      }
    });

    // Strategy C: Check "Fully Solved (X)" or "Partially Solved (X)" tags
    if (totalSolved === 0) {
      let countFromTags = 0;
      $('h5, h3, p, span').each((_, el) => {
        const t = $(el).text();
        const tagMatch = t.match(/(?:Fully|Partially)\s+Solved\s*\((\d+)\)/i);
        if (tagMatch) countFromTags += parseInt(tagMatch[1], 10);
      });
      if (countFromTags > 0) totalSolved = countFromTags;
    }

    if (totalSolved === 0 && solvedProblems.length > 0) {
      totalSolved = solvedProblems.length;
    }

    // Cache on Vercel's edge network for 10 minutes
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
      solvedProblems: solvedProblems.slice(0, 100),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to scrape CodeChef profile',
      error: err.message,
    });
  }
};