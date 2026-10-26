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
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    // 1. Fetch Profile Page (Ratings, Stars, and Ranks)
    const profileUrl = `https://www.codechef.com/users/${encodeURIComponent(handle)}`;
    const profileRes = await axios.get(profileUrl, { headers: browserHeaders, timeout: 8000 });
    const profileHtml = profileRes.data;

    if (profileHtml.includes("User doesn't exist") || profileHtml.includes('Could not find user')) {
      return res.status(404).json({ success: false, message: 'CodeChef user not found' });
    }

    const $ = cheerio.load(profileHtml);

    // Current Rating & Peak
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

    // Rating Timeline
    let ratingData = [];
    const ratingMatch = profileHtml.match(/var\s+all_rating\s*=\s*(\[.*?\]);/s);
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

    // Total Solved Count from Profile Header
    let totalSolved = 0;
    const totalMatch = profileHtml.match(/Total Problems Solved:\s*(\d+)/i);
    if (totalMatch && totalMatch[1]) {
      totalSolved = parseInt(totalMatch[1], 10);
    }

    // 2. Fetch Public Submissions Table (Status 15 = Accepted Only)
    // This gives the exact date, problem name, and solve time
    let solvedProblems = [];
    const dateCounts = {};

    try {
      const subsUrl = `https://www.codechef.com/submissions?sort_by=All&sorting_order=asc&language=All&status=15&year=&handle=${encodeURIComponent(handle)}&pname=`;
      const subsRes = await axios.get(subsUrl, { headers: browserHeaders, timeout: 8000 });
      const $s = cheerio.load(subsRes.data);

      $s('table.dataTable tbody tr').each((_, row) => {
        const cols = $s(row).find('td');
        if (cols.length >= 4) {
          const dateText = $s(cols[0]).text().trim(); // format: "08:42 PM 21/10/26" or "21/10/26 20:42"
          const probCol = $s(cols[1]).find('a');
          const probCode = probCol.text().trim();

          if (probCode) {
            // Parse standard DD/MM/YY date
            const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{2})/);
            let formattedDate = '';
            if (dateMatch) {
              const day = dateMatch[1];
              const month = dateMatch[2];
              const year = `20${dateMatch[3]}`;
              formattedDate = `${year}-${month}-${day}`;

              dateCounts[formattedDate] = (dateCounts[formattedDate] || 0) + 1;
            }

            solvedProblems.push({
              code: probCode,
              name: probCode,
              solvedAt: formattedDate || dateText,
            });
          }
        }
      });
    } catch (_) {}

    // 3. Format Daily Heatmap Array
    let heatMap = [];
    for (const [date, count] of Object.entries(dateCounts)) {
      heatMap.push({ date, value: count });
    }

    // Fallback: If submissions table was paginated/short, retain contest dates
    if (heatMap.length === 0 && ratingData.length > 0) {
      for (const contest of ratingData) {
        if (contest.end_date) {
          const d = contest.end_date.split(' ')[0];
          heatMap.push({ date: d, value: 3 });
        }
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