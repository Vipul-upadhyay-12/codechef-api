const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  // 1. Enable Global CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const handle = req.query.handle || req.query.username;

  if (!handle) {
    return res.status(400).json({
      success: false,
      message: 'Handle parameter is required. Example: /handle/gennady.korotkevich',
    });
  }

  try {
    const targetUrl = `https://www.codechef.com/users/${encodeURIComponent(handle)}`;

    // 2. Browser fingerprint headers to bypass Cloudflare bot filters
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      timeout: 8000,
    });

    const html = response.data;

    if (html.includes("User doesn't exist") || html.includes('Could not find user')) {
      return res.status(404).json({ success: false, message: 'CodeChef user not found' });
    }

    const $ = cheerio.load(html);

    // 3. Current Rating & Peak Rating
    const currentRatingText = $('.rating-number').first().text().trim();
    const currentRating = parseInt(currentRatingText, 10) || 0;

    let highestRating = 0;
    const ratingHeaderSmall = $('.rating-header small').text();
    const peakMatch = ratingHeaderSmall.match(/Highest Rating\s*(\d+)/i);
    if (peakMatch) {
      highestRating = parseInt(peakMatch[1], 10);
    } else {
      highestRating = currentRating;
    }

    // Stars (e.g. 1★, 2★, 7★)
    const stars = $('.rating-star').length;

    // Global & Country Rank
    let globalRank = 0;
    let countryRank = 0;
    $('.rating-ranks ul.inline-list li strong').each((i, el) => {
      const val = parseInt($(el).text().trim(), 10);
      if (i === 0 && !isNaN(val)) globalRank = val;
      if (i === 1 && !isNaN(val)) countryRank = val;
    });

    // 4. Rating History Extraction
    // CodeChef stores historical contest ratings in a JavaScript variable: `var all_rating = [...]`
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
      } catch (_) {
        // Fallback: Continue without contest array if JSON parsing fails
      }
    }

    // 5. Total Problems Solved
    let totalSolved = 0;
    let solvedProblems = [];
    $('section.problems-solved article').each((_, article) => {
      const pText = $(article).find('p').text();
      const countMatch = pText.match(/\((\d+)\)/);
      if (countMatch) {
        totalSolved += parseInt(countMatch[1], 10);
      }

      $(article)
        .find('span a')
        .each((_, a) => {
          const problemName = $(a).text().trim();
          if (problemName) solvedProblems.push(problemName);
        });
    });

    // In case problem list elements were formatted differently:
    if (totalSolved === 0 && solvedProblems.length > 0) {
      totalSolved = solvedProblems.length;
    }

    // 6. Cache on Vercel's Edge for 10 minutes (prevents spam and rate-limits)
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