// Fiction Zone (fictionzone.net) for LNReader Arabic.
// Covers the whole catalogue: the translated library (/novel/...) and the
// Chinese "platform" novels (fq-..., qimao-...) that the site reads through
// its Omniportal. Omniportal chapters are only served to signed-in readers,
// so the plugin reuses the login made in the in-app WebView.
// Written in ES5 with promise chains because the app evaluates plugins as-is.
var fetchLib = require('@libs/fetch');
var statusLib = require('@libs/novelStatus');
var filterLib = require('@libs/filterInputs');
var storageLib = require('@libs/storage');

var fetchApi = fetchLib.fetchApi;
var NovelStatus = statusLib.NovelStatus;
var FilterTypes = filterLib.FilterTypes;
var storage = storageLib.storage;
var webLocalStorage = storageLib.localStorage;
var webSessionStorage = storageLib.sessionStorage;

var SITE = 'https://fictionzone.net';
var API = SITE + '/api/__api_party/fictionzone';
var COVER = 'https://cdn.fictionzone.net/insecure/rs:fill:330:500/';
var PAGE_SIZE = 20; // the API caps pages at 20
var TIMEOUT_MS = 25000;
var JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

var GENRES = [
  { label: 'Fan-Fiction', value: '3' },
  { label: 'Fantasy', value: '1' },
  { label: 'Romance', value: '8' },
  { label: 'Sci-Fi', value: '6' },
  { label: 'Urban', value: '2' },
  { label: 'Virtual Reality', value: '7' },
];
var TAGS = [
  { label: 'Ability Steal', value: '46' },
  { label: 'American Comics', value: '18' },
  { label: 'Apocalypse', value: '30' },
  { label: 'Automatic Upgrade', value: '176' },
  { label: 'Battle Through The Heavens Fanfiction', value: '158' },
  { label: 'Beast Tamer', value: '31' },
  { label: 'Begins in Womb', value: '220' },
  { label: 'Black Clover', value: '225' },
  { label: 'Bleach', value: '108' },
  { label: 'Chat Group', value: '133' },
  { label: 'Chinese Ancient Kingdom', value: '92' },
  { label: 'Chinese Prehistoric', value: '75' },
  { label: 'Choice Selection', value: '54' },
  { label: 'City Building', value: '89' },
  { label: 'Clan/Sect Development', value: '84' },
  { label: 'Conferred God', value: '224' },
  { label: 'Cultivation', value: '1' },
  { label: 'DC', value: '126' },
  { label: 'DeepL Translation', value: '169' },
  { label: 'Demon Slayer', value: '140' },
  { label: 'Detective Conan', value: '193' },
  { label: 'Disciple Training', value: '113' },
  { label: 'Douluo Dalu Fanfiction', value: '148' },
  { label: 'Dragon Ball', value: '28' },
  { label: 'Evil Protagonist', value: '209' },
  { label: 'Experience Multiplier', value: '2' },
  { label: 'Fairy Tail', value: '10' },
  { label: 'Faloo', value: '3' },
  { label: 'Fate/Stay Night', value: '226' },
  { label: 'Female Lead', value: '82' },
  { label: 'Food Wars!', value: '60' },
  { label: 'Game Elements', value: '34' },
  { label: 'Gene Modification', value: '47' },
  { label: 'Genshin Impact', value: '207' },
  { label: 'God Ability', value: '219' },
  { label: 'Harem', value: '4' },
  { label: 'Harry Potter', value: '184' },
  { label: 'Honkai Impact', value: '227' },
  { label: 'Hunter x Hunter', value: '74' },
  { label: 'Improved Translation', value: '229' },
  { label: 'Inner Voice', value: '58' },
  { label: 'Journey to the West', value: '116' },
  { label: 'Jujutsu Kaisen', value: '190' },
  { label: 'Life Script', value: '213' },
  { label: 'Live Broadcast', value: '38' },
  { label: 'Lord Ability', value: '218' },
  { label: 'Luck Plunder', value: '211' },
  { label: 'Male Protagonist', value: '210' },
  { label: 'Memory Reveal', value: '212' },
  { label: 'Misunderstandings', value: '77' },
  { label: 'Multi-Wife/Multi-Children Blessing System', value: '228' },
  { label: 'My Hero Academia', value: '80' },
  { label: 'Naruto', value: '20' },
  { label: 'No Romance', value: '143' },
  { label: 'Non-System Based Cheat', value: '68' },
  { label: 'One Punch Man', value: '164' },
  { label: 'Perfect World', value: '94' },
  { label: 'Pirate', value: '26' },
  { label: 'Pokemon', value: '63' },
  { label: 'Poor to Rich', value: '22' },
  { label: 'Prince of Tennis', value: '53' },
  { label: 'Protagonist Hunting', value: '5' },
  { label: 'Ranking List', value: '138' },
  { label: 'Rebirthed Protagonist', value: '44' },
  { label: 'Romance', value: '103' },
  { label: 'Sentient Skills', value: '48' },
  { label: 'Shrouding The Heavens Fanfiction', value: '217' },
  { label: 'Sign-In/Check-In', value: '23' },
  { label: 'Simulation', value: '221' },
  { label: 'Special Forces', value: '131' },
  { label: 'Special Physique', value: '215' },
  { label: 'Spiritual Qi Recovery Era', value: '6' },
  { label: 'Sports', value: '71' },
  { label: 'Storyteller', value: '216' },
  { label: 'Stranded Survival', value: '222' },
  { label: 'Strong Background', value: '7' },
  { label: 'Strong Protagonist', value: '174' },
  { label: 'Strong to Stronger', value: '101' },
  { label: 'Super Technology', value: '42' },
  { label: 'Swallowed Star', value: '199' },
  { label: 'Sword Art Online', value: '153' },
  { label: 'System', value: '8' },
  { label: 'Talents', value: '49' },
  { label: 'Territory Management', value: '204' },
  { label: 'Toriko', value: '123' },
  { label: 'Transmigrated Protagonist', value: '13' },
  { label: 'Villain Protagonist', value: '9' },
  { label: 'Weak to Clan/Sect Development', value: '157' },
  { label: 'Weak to Strong', value: '51' },
  { label: 'Western Fantasy', value: '223' },
  { label: 'World Hopping', value: '16' },
  { label: 'World of Warcraft', value: '188' },
  { label: 'Yaoi', value: '214' },
];

function isPlatformSlug(slug) {
  return /^(fq|qimao)-/.test(slug);
}

function cover(image) {
  return image ? COVER + image + '.webp' : undefined;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toStatus(status) {
  if (status === 1) return NovelStatus.Ongoing;
  if (status === 2) return NovelStatus.Completed;
  return NovelStatus.Unknown;
}

function findToken(value, depth) {
  if (value === null || value === undefined || depth > 4) return undefined;
  if (typeof value === 'string') {
    var match = value.match(JWT);
    if (match) return match[0];
    var first = value.charAt(0);
    if (first === '{' || first === '[' || first === '"') {
      try {
        return findToken(JSON.parse(value), depth + 1);
      } catch (e) {
        return undefined;
      }
    }
    return undefined;
  }
  if (typeof value === 'object') {
    var keys = Object.keys(value);
    // Prefer entries that look like auth data before scanning everything.
    keys.sort(function (a, b) {
      var ta = /token|auth|session|user/i.test(a) ? 0 : 1;
      var tb = /token|auth|session|user/i.test(b) ? 0 : 1;
      return ta - tb;
    });
    for (var i = 0; i < keys.length; i++) {
      var found = findToken(value[keys[i]], depth + 1);
      if (found) return found;
    }
    for (var j = 0; j < keys.length; j++) {
      var v = value[keys[j]];
      if (
        /^(access_?token|auth_?token|token|jwt)$/i.test(keys[j]) &&
        typeof v === 'string' &&
        v.length > 20
      ) {
        return v.replace(/^Bearer\s+/i, '');
      }
    }
  }
  return undefined;
}

function FictionZonePlugin() {
  this.id = 'fictionzone';
  this.name = 'Fiction Zone';
  this.icon = 'src/en/fictionzone/icon.png';
  this.site = SITE;
  this.version = '2.0.4';
  // Each chapter is one small API call, so several can download at once.
  this.downloadConcurrency = 4;
  this.webStorageUtilized = true;
  this.pluginSettings = {
    token: {
      value: '',
      label:
        'Login token (optional). Leave empty: signing in from the WebView is picked up automatically',
    },
  };
  this.filters = {
    sort: {
      label: 'Sort by',
      type: FilterTypes.Picker,
      value: 'bookmark_count',
      options: [
        { label: 'Most followed', value: 'bookmark_count' },
        { label: 'Most viewed', value: 'views_all' },
        { label: 'Top rated', value: 'rating' },
        { label: 'Recently updated', value: 'chapter_last_created_at' },
        { label: 'Newest', value: 'created_at' },
        { label: 'Most chapters', value: 'chapter_count' },
      ],
    },
    order: {
      label: 'Order',
      type: FilterTypes.Picker,
      value: 'desc',
      options: [
        { label: 'Descending', value: 'desc' },
        { label: 'Ascending', value: 'asc' },
      ],
    },
    genres: {
      label: 'Genres (any of)',
      type: FilterTypes.ExcludableCheckboxGroup,
      value: {},
      options: GENRES,
    },
    tags: {
      label: 'Tags (any of)',
      type: FilterTypes.ExcludableCheckboxGroup,
      value: {},
      options: TAGS,
    },
  };
}

FictionZonePlugin.prototype.token = function () {
  var manual = storage.get('token');
  if (typeof manual === 'string' && manual.trim()) {
    return manual.trim().replace(/^Bearer\s+/i, '');
  }
  var local = webLocalStorage.get() || {};
  // The Authorization header the site itself sent while signed in (recorded
  // by the app's WebView) is the most reliable source.
  var sent = local.__site_authorization;
  if (typeof sent === 'string' && sent.trim()) {
    return sent.trim().replace(/^Bearer\s+/i, '');
  }
  return findToken(local, 0) || findToken(webSessionStorage.get(), 0);
};

FictionZonePlugin.prototype.api = function (path, withAuth) {
  var self = this;
  if (!withAuth || !this.token()) return this.request(path, false);
  // A stale or rejected login must never break reading the public library.
  return this.request(path, true).catch(function () {
    return self.request(path, false);
  });
};

// One retry: a dropped or stalled connection is the usual reason a chapter
// download fails, and it rarely happens twice in a row.
FictionZonePlugin.prototype.request = function (path, withAuth) {
  var self = this;
  return this.send(path, withAuth).catch(function (error) {
    if (error && error.fzReply) throw error;
    return self.send(path, withAuth);
  });
};

FictionZonePlugin.prototype.send = function (path, withAuth) {
  var headers = [['content-type', 'application/json']];
  var token = withAuth ? this.token() : undefined;
  if (token) headers.push(['authorization', 'Bearer ' + token]);
  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, TIMEOUT_MS);
  return fetchApi(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': SITE,
      'Referer': SITE + '/',
    },
    body: JSON.stringify({ path: path, headers: headers, method: 'GET' }),
    signal: controller.signal,
  })
    .then(function (res) {
      return res.text();
    })
    .then(
      function (text) {
        clearTimeout(timer);
        return text;
      },
      function (error) {
        clearTimeout(timer);
        throw error;
      },
    )
    .then(function (text) {
      var json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        throw new Error(
          'Fiction Zone did not answer. Open it in WebView once to pass the security check.',
        );
      }
      if (!json.success) {
        var err = json.error || {};
        var failure = new Error(
          err.message || json.message || 'Fiction Zone error',
        );
        failure.fzReply = true; // the site answered: retrying won't help
        throw failure;
      }
      return json.data;
    });
};

FictionZonePlugin.prototype.browse = function (query) {
  return this.api('/platform/browse?' + query + '&include_genres=true').then(
    function (data) {
      return (data.novels || []).map(function (n) {
        return {
          name: n.title,
          cover: cover(n.image),
          path: 'novel/' + n.slug,
        };
      });
    },
  );
};

FictionZonePlugin.prototype.popularNovels = function (pageNo, options) {
  var filters = (options && options.filters) || {};
  var sort = filters.sort ? filters.sort.value : 'bookmark_count';
  var order = filters.order ? filters.order.value : 'desc';
  if (options && options.showLatestNovels) {
    sort = 'chapter_last_created_at';
    order = 'desc';
  }
  var q =
    'page=' +
    pageNo +
    '&page_size=' +
    PAGE_SIZE +
    '&sort_by=' +
    sort +
    '&sort_order=' +
    order;
  var groups = [
    ['genres', 'genre_ids'],
    ['tags', 'tag_ids'],
  ];
  for (var i = 0; i < groups.length; i++) {
    var f = filters[groups[i][0]];
    var v = (f && f.value) || {};
    if (v.include && v.include.length) {
      q += '&' + groups[i][1] + '=' + v.include.join(',');
    }
    if (v.exclude && v.exclude.length) {
      q += '&exclude_' + groups[i][1] + '=' + v.exclude.join(',');
    }
  }
  return this.browse(q);
};

FictionZonePlugin.prototype.searchNovels = function (searchTerm, pageNo) {
  var self = this;
  // A pasted Fiction Zone link or Omniportal link opens that novel directly.
  var link = searchTerm.match(/omniportal\/([a-z]+)\/(\d+)/i);
  var novel = searchTerm.match(/fictionzone\.net\/novel\/([^/?#\s]+)/i);
  var slug = link ? link[1].toLowerCase() + '-' + link[2] : novel && novel[1];
  if (slug) {
    if (pageNo > 1) return Promise.resolve([]);
    return this.api('/platform/novel-details?slug=' + encodeURIComponent(slug))
      .then(function (d) {
        return [
          { name: d.title, cover: cover(d.image), path: 'novel/' + slug },
        ];
      })
      .catch(function () {
        return [];
      });
  }
  return self.browse(
    'search=' +
      encodeURIComponent(searchTerm) +
      '&page=' +
      pageNo +
      '&page_size=' +
      PAGE_SIZE +
      '&search_in_synopsis=false&sort_by=bookmark_count&sort_order=desc',
  );
};

FictionZonePlugin.prototype.parseNovel = function (novelPath) {
  var self = this;
  var slug = novelPath.replace(/^novel\//, '');
  return this.api(
    '/platform/novel-details?slug=' + encodeURIComponent(slug),
    true,
  ).then(function (d) {
    var author = (d.contributors || []).filter(function (c) {
      return c.role === 'author';
    })[0];
    var names = (d.genres || []).concat(d.tags || []).map(function (g) {
      return g.name;
    });
    var alt = (d.alt_titles || []).filter(Boolean);
    var summary = d.synopsis || '';
    if (alt.length) summary += '\n\nAlso known as: ' + alt.join(' / ');
    var novel = {
      path: novelPath,
      name: d.title,
      cover: cover(d.image),
      genres: names.join(','),
      status: toStatus(d.status),
      author: author ? author.display_name : '',
      summary: summary,
    };
    return self
      .chapters(d.id, novelPath)
      .catch(function () {
        return [];
      })
      .then(function (chapters) {
        novel.chapters = chapters;
        if (!chapters.length && isPlatformSlug(slug)) {
          novel.summary =
            (self.token()
              ? '⚠ Fiction Zone did not return the chapters. Open the novel in WebView (globe icon) once, then pull down to refresh.'
              : '⚠ This novel is from Fiction Zone Omniportal and its chapters need a Fiction Zone login. Tap the globe icon, sign in on the site, go back, then pull down to refresh.') +
            '\n\n' +
            novel.summary;
        }
        return novel;
      });
  });
};

FictionZonePlugin.prototype.chapters = function (novelId, novelPath) {
  return this.api('/platform/chapter-lists?novel_id=' + novelId, true).then(
    function (data) {
      return (data.chapters || []).map(function (c) {
        return {
          name: c.title,
          chapterNumber: c.chapter_number,
          releaseTime: c.published_date
            ? new Date(c.published_date.replace(' ', 'T') + 'Z').toISOString()
            : undefined,
          path:
            novelPath +
            '/' +
            c.chapter_id +
            '|/platform/chapter-content?novel_id=' +
            novelId +
            '&chapter_id=' +
            c.chapter_id,
        };
      });
    },
  );
};

// The app asks for this when a novel was saved with no chapters (Omniportal
// novels before signing in), so it must exist or the novel fails to open.
FictionZonePlugin.prototype.parsePage = function (novelPath) {
  var self = this;
  var slug = novelPath.replace(/^novel\//, '');
  return this.api(
    '/platform/novel-details?slug=' + encodeURIComponent(slug),
    true,
  ).then(function (d) {
    return self.chapters(d.id, novelPath).then(function (chapters) {
      return { chapters: chapters };
    });
  });
};

FictionZonePlugin.prototype.parseChapter = function (chapterPath) {
  return this.api(chapterPath.split('|')[1], true).then(function (data) {
    var text = String(data.content || '').replace(/\r\n?/g, '\n');
    if (/<(p|br|div)[\s>/]/i.test(text)) return text;
    return text
      .split(/\n+/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean)
      .map(function (line) {
        return '<p>' + escapeHtml(line) + '</p>';
      })
      .join('\n');
  });
};

FictionZonePlugin.prototype.resolveUrl = function (path, isNovel) {
  var novelPath = path.split('|')[0];
  var parts = novelPath.split('/');
  var slug = parts[1] || '';
  var platform = slug.match(/^(fq|qimao)-(\d+)$/);
  if (platform) {
    return (
      SITE +
      '/omniportal/' +
      platform[1] +
      '/' +
      platform[2] +
      (!isNovel && parts[2] ? '/' + parts[2] : '')
    );
  }
  return SITE + '/novel/' + slug;
};

// Lets the app's WebView offer "open in app" on a Fiction Zone novel page.
FictionZonePlugin.prototype.pathFromUrl = function (url) {
  var portal = url.match(/fictionzone\.net\/omniportal\/(fq|qimao)\/(\d+)/i);
  if (portal) return 'novel/' + portal[1].toLowerCase() + '-' + portal[2];
  var novel = url.match(/fictionzone\.net\/novel\/([^/?#]+)/i);
  return novel ? 'novel/' + novel[1] : undefined;
};

exports.default = new FictionZonePlugin();
