
var models = undefined;
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const liveResults = document.getElementById('live-results');
const resultCountLabel = document.getElementById('result-count-label');
const openLink = document.getElementById('open-link');

const isMobile =
   navigator.userAgentData?.mobile
   || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const defaultOptions = {
   includeScore: true,
   threshold: 0.3,
   ignoreLocation: true,
   minMatchCharLength: 2,
   keys: ['name', 'header', 'comments', 'shape', 'gear'],
};

const numericFilterFieldMap = {
   gear: 'gear',
   ri: 'ri',
   lw: 'lw',
   pw: 'pw',
   cw: 'cw',
   girdlecount: 'girdleCount',
   facetcount: 'facetCount',
};

const floatEqualityTolerance = 0.01;

function isEmbeddedInIframe() {
   return window.self !== window.top;
}

function notifyHostToOpenModel(event, modelUrl, webRayUrl) {
   if (!isEmbeddedInIframe()) {
      return;
   }

   window.parent.postMessage(
      {
         type: 'gemlibrary:open-model',
         modelUrl,
         webRayUrl,
      },
      '*'
   );

   // If embedded, let parent decide where/how to navigate.
   event.preventDefault();
}

/*
[
  {
    "name": "PC01001.ASC",
    "header": "",
    "comments": "",
    "gear": 64,
    "ri": 1.54,
    "symmetries": [
      16,
      4
    ],
    "symmetryCounts": {
      "4": 2,
      "16": 2
    },
    "lw": 1,
    "pw": 0.4262917972530948,
    "cw": 0.15092101690983614,
    "girdleCount": 16,
    "facetCount": 45,
    "shape": "Round"
  },
]

*/

function getRandomModel() {
   if (models === undefined) {
      window.alert('Models are not loaded yet');
      return;
   }
   const randomIndex = Math.floor(Math.random() * models.length);
   const model = models[randomIndex];
   openPanel(model);
}

/*
<!-- Your Grid Item -->
<div class="grid-item" onclick="openPanel('PC46017.ASC.avif', 'Item Title')">
  <img src="models/PC46017.ASC.avif" alt="Image">
</div>
*/

function createLink(model) {
   link = document.createElement('a');
   link.href = `models/${model.name}`;
   link.textContent = model.name;
   link.target = '_blank';
   return link;
}
function createThumbnail(model) {
   const img = document.createElement('img');
   img.src = `models/${model.name}.avif`;
   img.alt = model.name;
   return img
}
function createResult(model) {
   const result = document.createElement('div');
   result.className = 'grid-item';

   const thumbnail = createThumbnail(model);
   result.appendChild(thumbnail);

   const title = document.createElement('div');
   title.className = 'title';
   title.textContent = model.name;
   result.appendChild(title);

   result.onclick = () => {
      openPanel(model);
   };


   return result;
}

function parseSearchQuery(rawQuery) {
   const query = String(rawQuery || '');
   const filters = [];

   // Field filter format: ri<1.7, gear = 96, facetCount>=45
   const filterPattern = /\b([a-zA-Z][a-zA-Z0-9]*)\s*(<=|>=|!=|=|<|>)\s*(-?\d*\.?\d+)\b/g;
   let keywordQuery = query;

   keywordQuery = keywordQuery.replace(filterPattern, (fullMatch, field, operator, value) => {
      const normalizedField = field.toLowerCase();
      const modelField = numericFilterFieldMap[normalizedField];
      if (!modelField) {
         return ' ';
      }

      const numericValue = Number.parseFloat(value);
      if (Number.isNaN(numericValue)) {
         return ' ';
      }

      filters.push({
         field: modelField,
         operator,
         value: numericValue,
      });
      return ' ';
   });

   keywordQuery = keywordQuery.replace(/\s+/g, ' ').trim();
   return { keywordQuery, filters };
}

function compareNumericValue(modelValue, operator, filterValue) {
   const numericModelValue = Number(modelValue);
   if (Number.isNaN(numericModelValue)) {
      return false;
   }

   switch (operator) {
      case '<':
         return numericModelValue < filterValue;
      case '<=':
         return numericModelValue <= filterValue;
      case '>':
         return numericModelValue > filterValue;
      case '>=':
         return numericModelValue >= filterValue;
      case '=':
         return Math.abs(numericModelValue - filterValue) <= floatEqualityTolerance;
      case '!=':
         return Math.abs(numericModelValue - filterValue) > floatEqualityTolerance;
      default:
         return false;
   }
}

function applyNumericFilters(modelList, filters) {
   if (filters.length === 0) {
      return modelList;
   }

   return modelList.filter(model => {
      return filters.every(filter => {
         return compareNumericValue(model[filter.field], filter.operator, filter.value);
      });
   });
}

function tokenizeKeywordQuery(keywordQuery) {
   return String(keywordQuery || '')
      .split(/\s+/)
      .map(term => term.trim())
      .filter(term => term !== '');
}

function compareRankedMatches(a, b) {
   if (a.matchedTerms !== b.matchedTerms) {
      return b.matchedTerms - a.matchedTerms;
   }
   if (a.averageScore !== b.averageScore) {
      return a.averageScore - b.averageScore;
   }
   return a.item.name.localeCompare(b.item.name);
}

function fuzzySearchModels(modelList, keywordQuery, options) {
   const terms = tokenizeKeywordQuery(keywordQuery);
   if (terms.length === 0) {
      return modelList;
   }

   const fuse = new Fuse(modelList, options);
   const scoreByItem = new Map();

   terms.forEach(term => {
      const hits = fuse.search(term);
      hits.forEach(hit => {
         const score = hit.score ?? 1;
         const entry = scoreByItem.get(hit.item) || {
            item: hit.item,
            matchedTerms: 0,
            scoreSum: 0,
            averageScore: 1,
            matchedTermSet: new Set(),
         };

         if (!entry.matchedTermSet.has(term)) {
            entry.matchedTermSet.add(term);
            entry.matchedTerms += 1;
            entry.scoreSum += score;
            entry.averageScore = entry.scoreSum / entry.matchedTerms;
            scoreByItem.set(hit.item, entry);
         }
      });
   });

   const ranked = Array.from(scoreByItem.values());
   const fullyMatched = ranked
      .filter(entry => entry.matchedTerms === terms.length)
      .sort(compareRankedMatches)
      .map(entry => entry.item);

   if (fullyMatched.length > 0) {
      return fullyMatched;
   }

   return ranked
      .sort(compareRankedMatches)
      .map(entry => entry.item);
}

function updateResultCount(resultCount, totalCount, hasActiveQuery) {
   if (!resultCountLabel) {
      return;
   }

   if (hasActiveQuery) {
      resultCountLabel.textContent = `Results: ${resultCount} / ${totalCount}`;
      return;
   }

   resultCountLabel.textContent = `Total gems: ${totalCount}`;
}

function search(query, options) {
   if (models === undefined) {
      console.error("Models not loaded yet");
      return;
   }

   const { keywordQuery, filters } = parseSearchQuery(query);

   let resultModels = applyNumericFilters(models, filters);
   resultModels = fuzzySearchModels(resultModels, keywordQuery, options);
   const hasActiveQuery = keywordQuery !== '' || filters.length > 0;
   updateResultCount(resultModels.length, models.length, hasActiveQuery);

   // Clear the search results container
   searchResults.innerHTML = '';

   // Update the search results container
   resultModels.forEach(model => {
      searchResults.appendChild(createResult(model));
   });
}

// Load the JSON data
fetch('models/metadata.json')
   .then(response => response.json())
   .then(data => {
      models = data;
      updateResultCount(models.length, models.length, false);

      // Check URL (Eg. ?q=chinchilla)
      const url = new URL(window.location.href);
      const searchParams = url.searchParams;
      const urlQuery = searchParams.get('q');
      if (urlQuery !== null) {
         searchInput.value = urlQuery;
         search(urlQuery, defaultOptions);
      }

      // Add an event listener to the search input
      searchInput.addEventListener('keyup', (event) => {
         if (event.key !== "Enter" && !liveResults.checked) {
            return;
         }
         // Get the search query
         const query = searchInput.value.toLowerCase();
         const options = defaultOptions;

         search(query, options);

         // Update the URL
         url.searchParams.set('q', query);
         window.history.pushState({}, '', url);
      });

   });

function openPanel(model) {
   const modelUrl = `https://bogdanthegeek.github.io/GemLibrary/models/${model.name}`;
   const webRayUrl = `https://bogdanthegeek.github.io/WebRay/?model=${modelUrl}`;

   // Update panel content
   document.getElementById("panel-title").innerText = model.name;
   document.getElementById("panel-img").src = "models/" + model.name + ".avif";
   document.getElementById("download-link").href = "models/" + model.name;
   openLink.href = webRayUrl;

   openLink.onclick = function(event) {
      notifyHostToOpenModel(event, modelUrl, webRayUrl);
   };

   document.getElementById("panel-info").innerHTML = `
      <p><strong>Description:</strong></p>
      <p>${model.header || 'None'}</p>
      <p><strong>Shape:</strong>      ${model.shape}</p>
      <p><strong>RI:</strong>         ${(model.ri || 0).toFixed(2)}</p>
      <p><strong>Gear:</strong>       ${model.gear}</p>
      <p><strong>Symmetries:</strong> ${model.symmetries.join(', ')}</p>
      <p><strong>L/W Ratio:</strong>  ${model.lw.toFixed(3)}</p>
      <p><strong>P/W Ratio:</strong>  ${model.pw.toFixed(3)}</p>
      <p><strong>C/W Ratio:</strong>  ${model.cw.toFixed(3)}</p>
      <p><strong>T/W Ratio:</strong>  ${model.tw.toFixed(3)}</p>
      <p><strong>U/W Ratio:</strong>  ${model.uw.toFixed(3)}</p>
      <p><strong>Facets:</strong>     ${model.facetCount}</p>
      <p><strong>Notes:</strong><p>
      <p>${model.comments || 'None'}</p>
   `;

   // Slide the panel open
   document.getElementById("side-panel").style.width = isMobile ? "100%" : "440px";
   document.getElementById("panel-overlay").style.display = "block";
}

function closePanel() {
   // Slide the panel closed
   document.getElementById("side-panel").style.width = "0";
   document.getElementById("panel-overlay").style.display = "none";
}

document.addEventListener('keydown', function(event) {
   if (event.key === "Escape") {
      closePanel();
   }
});

preffersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
colorSchemeToggle = document.getElementById("color-scheme-toggle");

colorSchemeToggle.checked = preffersDark;
colorSchemeToggle.addEventListener("click", function() {
   const body = document.body;

   if (body.style.colorScheme === '') {
      body.style.colorScheme = preffersDark ? 'light' : 'dark';
   } else {
      body.style.colorScheme = body.style.colorScheme === 'dark' ? 'light' : 'dark';
   }
});
