// Fiction Empire: Mohamed's own Arabic novels for LNReader Arabic.
// The novels live on the `fiction-empire` branch of this repo (index.json,
// covers/, chapters/<novel>/<NNN>.html), published there by
// /mnt/project-files/novel/fiction-empire/sync.py. New chapters show up as
// soon as that branch is pushed; nothing in the app has to change.
// Written in ES5 with promise chains because the app evaluates plugins as-is.
var fetchLib = require('@libs/fetch');
var statusLib = require('@libs/novelStatus');

var fetchApi = fetchLib.fetchApi;
var NovelStatus = statusLib.NovelStatus;

var DATA =
  'https://raw.githubusercontent.com/vetmohamed-arch/lnreader-arabic/fiction-empire/';
var SITE =
  'https://github.com/vetmohamed-arch/lnreader-arabic/tree/fiction-empire';
var TIMEOUT_MS = 25000;
var INDEX_TTL_MS = 60000;

function FictionEmpirePlugin() {
  this.id = 'fictionempire';
  this.name = 'Fiction Empire';
  this.icon = 'src/ar/fictionempire/icon.png';
  this.site = SITE;
  // Same spelling as the app's language filter, or the plugin stays hidden.
  this.lang = '\u200eالعربية';
  this.version = '1.0.1';
  this.downloadConcurrency = 4;
  this.indexCache = undefined;
}

function get(url) {
  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, TIMEOUT_MS);
  return fetchApi(url, { signal: controller.signal }).then(
    function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('Fiction Empire: HTTP ' + res.status);
      return res.text();
    },
    function (error) {
      clearTimeout(timer);
      throw error;
    },
  );
}

// raw.githubusercontent.com keeps files for a few minutes; a changing query
// string gets a fresh copy, so the list is at most a minute old.
FictionEmpirePlugin.prototype.index = function () {
  var self = this;
  var now = Date.now();
  if (self.indexCache && now - self.indexCache.at < INDEX_TTL_MS) {
    return Promise.resolve(self.indexCache.data);
  }
  return get(DATA + 'index.json?t=' + Math.floor(now / INDEX_TTL_MS))
    .then(function (text) {
      var data = JSON.parse(text);
      self.indexCache = { at: now, data: data };
      return data;
    })
    .catch(function (error) {
      if (self.indexCache) return self.indexCache.data;
      throw error;
    });
};

FictionEmpirePlugin.prototype.findNovel = function (path) {
  var id = path.replace(/^novel\//, '').split('/')[0];
  return this.index().then(function (data) {
    var novels = data.novels || [];
    for (var i = 0; i < novels.length; i++) {
      if (novels[i].id === id) return novels[i];
    }
    throw new Error('Fiction Empire: novel not found (' + id + ')');
  });
};

function coverUrl(n) {
  return n.cover ? DATA + n.cover + '?v=' + (n.coverV || '') : undefined;
}

function toItem(n) {
  return { name: n.name, path: 'novel/' + n.id, cover: coverUrl(n) };
}

FictionEmpirePlugin.prototype.popularNovels = function (pageNo, options) {
  if (pageNo > 1) return Promise.resolve([]);
  return this.index().then(function (data) {
    var novels = (data.novels || []).slice();
    if (options && options.showLatestNovels) {
      var last = function (n) {
        var c = n.chapters || [];
        return c.length ? c[c.length - 1].date || '' : '';
      };
      novels.sort(function (a, b) {
        return last(b) < last(a) ? -1 : last(b) > last(a) ? 1 : 0;
      });
    }
    return novels.map(toItem);
  });
};

FictionEmpirePlugin.prototype.searchNovels = function (searchTerm, pageNo) {
  if (pageNo > 1) return Promise.resolve([]);
  var term = String(searchTerm || '')
    .trim()
    .toLowerCase();
  return this.index().then(function (data) {
    return (data.novels || [])
      .filter(function (n) {
        var text = [n.name, n.summary, (n.genres || []).join(' ')]
          .join(' ')
          .toLowerCase();
        return !term || text.indexOf(term) !== -1;
      })
      .map(toItem);
  });
};

FictionEmpirePlugin.prototype.parseNovel = function (novelPath) {
  return this.findNovel(novelPath).then(function (n) {
    return {
      name: n.name,
      path: 'novel/' + n.id,
      cover: coverUrl(n),
      author: n.author,
      genres: (n.genres || []).join(', '),
      summary: n.summary,
      status:
        n.status === 'Completed' ? NovelStatus.Completed : NovelStatus.Ongoing,
      chapters: (n.chapters || []).map(function (c) {
        return {
          name: c.title,
          path: n.id + '/' + c.file,
          chapterNumber: c.n,
          releaseTime: c.date,
        };
      }),
    };
  });
};

FictionEmpirePlugin.prototype.parseChapter = function (chapterPath) {
  var file = chapterPath.split('/')[1];
  var url = DATA + 'chapters/' + chapterPath + '.html';
  // The chapter's version in the list gets past the CDN after an edit.
  return this.findNovel(chapterPath)
    .then(
      function (n) {
        var c = (n.chapters || []).filter(function (ch) {
          return ch.file === file;
        })[0];
        return c && c.v ? url + '?v=' + c.v : url;
      },
      function () {
        return url;
      },
    )
    .then(get);
};

FictionEmpirePlugin.prototype.resolveUrl = function (path, isNovel) {
  var id = path.replace(/^novel\//, '').split('/')[0];
  if (isNovel) return SITE + '/chapters/' + id;
  return DATA + 'chapters/' + path + '.html';
};

exports.default = new FictionEmpirePlugin();
