/* World Cup 2026 — Goals Contest tracker
   Fetches the public-domain openfootball feed, sums every goal each team scores
   (including penalty-shootout goals), and ranks the configured nicknames. */

(function () {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };
  var norm = function (s) { return (s || "").trim(); };

  function setStatus(text, cls) {
    var el = $("#status");
    el.textContent = text;
    el.className = "status" + (cls ? " " + cls : "");
  }

  /* Goals a team scored in ONE match.
     - inPlay: score after extra time if present, otherwise full time (this
       already includes any penalties taken during play).
     - shootout: tie-breaker penalty shootout goals (score.p), counted only if
       enabled in config.

     Own goals are not inferable from score.ft/score.et alone. They require
     scorer text from the feed, where openfootball records them with an `og`
     marker, such as `Marcelo 11' og`. */
  function goalsForMatch(match, side /* 0 = team1, 1 = team2 */) {
    var s = match.score;
    if (!s) return { inPlay: 0, shootout: 0, played: false };
    var inPlaySrc = s.et || s.ft || s.ht;
    var inPlay = inPlaySrc ? (inPlaySrc[side] || 0) : 0;
    var shootout = (CONFIG.includeShootoutGoals && s.p) ? (s.p[side] || 0) : 0;
    return { inPlay: inPlay, shootout: shootout, played: true };
  }

  function scorerTextForMatch(match) {
    var parts = [];

    ["goals1", "goals2", "goals", "scorers", "scorer", "events", "notes", "note", "summary", "text", "raw", "line"].forEach(function (key) {
      if (match && match[key] !== undefined && match[key] !== null) {
        parts.push(match[key]);
      }
    });

    function flatten(value) {
      if (value === undefined || value === null) return "";
      if (Array.isArray(value)) return value.map(flatten).join(" ");
      if (typeof value === "object") {
        return Object.keys(value).map(function (key) { return flatten(value[key]); }).join(" ");
      }
      return String(value);
    }

    return parts.map(flatten).join(" ");
  }

  function countOwnGoalsInText(text) {
    var s = String(text || "");

    // Openfootball marks own goals in the goal/scorer entry, not in
    // score.ft / score.et. In the 2026 JSON feed the structured form is
    // usually `{ "owngoal": true }` inside goals1/goals2. Older text forms
    // include `61'og` and `11' (o.g.)`; tolerate common variants too.
    var matches = s.match(/\b\d+(?:\+\d+)?'\s*(?:\(?\s*o\.?g\.?\s*\)?|own\s+goal)\b/gi);
    return matches ? matches.length : 0;
  }


  function ownGoalCountForMatch(match) {
    if (!match) return 0;

    // Prefer structured goal/scorer fields when the JSON feed exposes them,
    // then fall back to flattened scorer text. This keeps the tracker robust
    // across openfootball JSON exports.
    var structuredCount = 0;
    ["goals1", "goals2", "goals", "scorers", "scorer", "events"].forEach(function (key) {
      var value = match[key];
      if (!Array.isArray(value)) return;

      value.forEach(function (item) {
        if (!item) return;
        if (typeof item === "string") {
          structuredCount += countOwnGoalsInText(item);
          return;
        }
        if (typeof item !== "object") return;

        var typeText = String(item.type || item.kind || item.event || item.note || item.notes || "").toLowerCase();
        var ownGoalFlag = item.own_goal === true || item.owngoal === true || item.og === true;
        if (ownGoalFlag || /\bown\s+goal\b|\bo\.?g\.?\b/.test(typeText)) {
          structuredCount += 1;
          return;
        }

        structuredCount += countOwnGoalsInText(Object.keys(item).map(function (prop) {
          return item[prop];
        }).join(" "));
      });
    });

    if (structuredCount) return structuredCount;

    return countOwnGoalsInText(scorerTextForMatch(match));
  }

  function ownGoalScoringTeamsForMatch(match) {
    if (!match) return [];

    var teams = [];

    function itemOwnGoalCount(item) {
      if (!item) return 0;
      if (typeof item === "string") return countOwnGoalsInText(item);
      if (typeof item !== "object") return 0;

      var typeText = String(item.type || item.kind || item.event || item.note || item.notes || "").toLowerCase();
      var ownGoalFlag = item.own_goal === true || item.owngoal === true || item.og === true;
      if (ownGoalFlag || /\bown\s+goal\b|\bo\.?g\.?\b/.test(typeText)) return 1;

      return countOwnGoalsInText(Object.keys(item).map(function (prop) {
        return item[prop];
      }).join(" "));
    }

    function collectFromSide(goalListKey, ownGoalScoringTeam) {
      var value = match[goalListKey];
      if (!Array.isArray(value)) return;

      value.forEach(function (item) {
        var count = itemOwnGoalCount(item);
        for (var i = 0; i < count; i += 1) {
          teams.push(norm(ownGoalScoringTeam));
        }
      });
    }

    collectFromSide("goals1", match.team2);
    collectFromSide("goals2", match.team1);

    return teams;
  }

  function matchDateTimeValue(match) {
    if (!match) return 0;

    var dateText = match.date || "";
    var timeText = match.time || match.kickoff || match.datetime || match.timestamp || "";

    if (dateText && timeText) {
      var combined = String(dateText) + "T" + String(timeText).replace(/Z$/, "");
      var combinedTime = Date.parse(combined);
      if (!isNaN(combinedTime)) return combinedTime;
    }

    if (dateText) {
      var dateTime = Date.parse(String(dateText));
      if (!isNaN(dateTime)) return dateTime;
    }

    if (timeText) {
      var timeOnly = Date.parse(String(timeText));
      if (!isNaN(timeOnly)) return timeOnly;
    }

    return 0;
  }

  function minuteToNumber(minute) {
    var text = String(minute || "0");
    var parts = text.split("+");
    var base = parseInt(parts[0], 10) || 0;
    var extra = parseInt(parts[1], 10) || 0;
    return base + extra;
  }

  function goalSortKey(match, goal, fallbackIndex) {
    var base = matchDateTimeValue(match);
    var minuteOffset = minuteToNumber(goal && goal.minute) * 60 * 1000;
    return base + minuteOffset + fallbackIndex;
  }

  function getTeamGoalEvents(matches) {
    var events = {}; // teamName -> [{ sortKey }]

    function addEvent(team, sortKey) {
      var t = norm(team);
      if (!t) return;
      if (!events[t]) events[t] = [];
      events[t].push({ sortKey: sortKey });
    }

    matches.forEach(function (match) {
      var goals1 = Array.isArray(match.goals1) ? match.goals1 : [];
      var goals2 = Array.isArray(match.goals2) ? match.goals2 : [];

      goals1.forEach(function (goal, idx) {
        addEvent(match.team1, goalSortKey(match, goal, idx));
      });
      goals2.forEach(function (goal, idx) {
        addEvent(match.team2, goalSortKey(match, goal, idx));
      });

      if (CONFIG.includeShootoutGoals && match.score && match.score.p) {
        var shootoutBase = goalSortKey(match, { minute: "130" }, goals1.length + goals2.length);
        var p1 = match.score.p[0] || 0;
        var p2 = match.score.p[1] || 0;
        for (var i = 0; i < p1; i += 1) addEvent(match.team1, shootoutBase + i);
        for (var j = 0; j < p2; j += 1) addEvent(match.team2, shootoutBase + p1 + j);
      }
    });

    Object.keys(events).forEach(function (team) {
      events[team].sort(function (a, b) { return a.sortKey - b.sortKey; });
    });

    return events;
  }

  function ownGoalScoringTeams(matches) {
    return matches.slice().sort(function (a, b) {
      return matchDateTimeValue(a) - matchDateTimeValue(b);
    }).reduce(function (teams, match) {
      return teams.concat(ownGoalScoringTeamsForMatch(match));
    }, []);
  }

  function countOwnGoals(matches) {
    return matches.reduce(function (sum, match) {
      return sum + ownGoalCountForMatch(match);
    }, 0);
  }

  function renderOwnGoalsTotal(total) {
    var el = $("#own-goals-total");
    if (!el) {
      var anchor = $("#updated") || $("#status") || $("#contest-title");
      el = document.createElement("div");
      el.id = "own-goals-total";
      el.className = "own-goals-total";
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(el, anchor.nextSibling);
      } else {
        document.body.insertBefore(el, document.body.firstChild);
      }
    }
    el.textContent = "Own goals: " + total;
  }

  /* Build a per-team tally from all matches. */
  function tallyTeams(matches) {
    var tally = {}; // teamName -> { inPlay, shootout, matches }
    function bump(team, g) {
      var t = norm(team);
      if (!tally[t]) tally[t] = { inPlay: 0, shootout: 0, matches: 0 };
      tally[t].inPlay += g.inPlay;
      tally[t].shootout += g.shootout;
      if (g.played) tally[t].matches += 1;
    }
    matches.forEach(function (m) {
      if (!m.score) return;            // only count finished/in-progress matches
      bump(m.team1, goalsForMatch(m, 0));
      bump(m.team2, goalsForMatch(m, 1));
    });
    return tally;
  }

  function validTeamSet() {
    var set = {};
    (typeof VALID_TEAM_NAMES !== "undefined" ? VALID_TEAM_NAMES : []).forEach(function (n) {
      set[norm(n)] = true;
    });
    return set;
  }

  function render(tally, matches) {
    var allMatches = Array.isArray(matches) ? matches : [];
    var validSet = validTeamSet();
    var unknown = [];
    var ownGoals = countOwnGoals(allMatches);
    var ownGoalTeams = ownGoalScoringTeams(allMatches);
    var teamGoalEvents = getTeamGoalEvents(allMatches);
    renderOwnGoalsTotal(ownGoals);

    var rows = CONFIG.entries.map(function (entry) {
      if (entry.type === "own_goals") {
        return {
          nickname: entry.nickname,
          type: "own_goals",
          teams: ownGoalTeams.map(function (teamName) {
            return {
              name: teamName,
              goals: 1,
              shootout: 0,
              matches: 0,
              known: validSet[teamName] === true,
            };
          }),
          total: ownGoals,
          shootout: 0,
          matches: "",
          lastGoalTime: ownGoals > 0 ? goalSortKey(
            allMatches.slice().sort(function (a, b) { return matchDateTimeValue(a) - matchDateTimeValue(b); })[
              allMatches.slice().sort(function (a, b) { return matchDateTimeValue(a) - matchDateTimeValue(b); }).length - 1
            ],
            { minute: "0" },
            ownGoals
          ) : null,
          eliminated: ownGoals >= 22,
          perfect: ownGoals === 21,
        };
      }
      var inPlay = 0, shootout = 0, teamMatches = 0;
      var goalEvents = [];
      var teams = (entry.teams || []).map(function (teamName) {
        var t = norm(teamName);
        var rec = tally[t] || { inPlay: 0, shootout: 0, matches: 0 };
        var known = validSet[t] === true;
        if (!known && Object.keys(validSet).length) unknown.push(t);
        inPlay += rec.inPlay;
        shootout += rec.shootout;
        teamMatches += rec.matches;
        goalEvents = goalEvents.concat(teamGoalEvents[t] || []);
        return {
          name: t,
          goals: rec.inPlay + rec.shootout,
          shootout: rec.shootout,
          matches: rec.matches,
          known: known,
        };
      });
      var total = inPlay + shootout;
      goalEvents.sort(function (a, b) { return a.sortKey - b.sortKey; });
      var lastGoalEvent = total > 0 ? goalEvents[total - 1] : null;
      return {
        nickname: entry.nickname,
        teams: teams,
        total: total,
        shootout: shootout,
        matches: teamMatches,
        lastGoalTime: lastGoalEvent ? lastGoalEvent.sortKey : null,
        eliminated: total >= 22,
        perfect: total === 21,
      };
    });

    rows.sort(function (a, b) {
      // Eliminated nicknames always sink to the bottom.
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      if (b.total !== a.total) return b.total - a.total;

      var aIsOwnGoal = norm(a.nickname).toLowerCase() === "own goal";
      var bIsOwnGoal = norm(b.nickname).toLowerCase() === "own goal";
      if (aIsOwnGoal !== bIsOwnGoal) return aIsOwnGoal ? -1 : 1;

      var aMatches = Number(a.matches) || 0;
      var bMatches = Number(b.matches) || 0;
      if (aMatches !== bMatches) return aMatches - bMatches;

      if (a.lastGoalTime !== b.lastGoalTime) {
        if (a.lastGoalTime === null) return 1;
        if (b.lastGoalTime === null) return -1;
        return a.lastGoalTime - b.lastGoalTime;
      }

      return a.nickname.localeCompare(b.nickname);
    });

    var body = $("#ranking-body");
    body.innerHTML = "";
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty">No participants yet. Add some in config.js.</td></tr>';
    }

    var activeRank = 0;
    rows.forEach(function (row, i) {
      var rank = row.eliminated ? null : ++activeRank;
      var isOwnGoalsEntry = row.type === "own_goals";
      var badge = row.eliminated ? "OUT" : rank;
      var statusBadge = row.eliminated
        ? '<span class="status-badge ko-badge" aria-label="Knocked out">KO</span>'
        : row.perfect
          ? '<span class="status-badge perfect-badge" aria-label="Perfect score">Perfect!</span>'
          : '';
      var tr = document.createElement("tr");
      tr.className = "row" + (row.eliminated ? " eliminated" : (row.perfect ? " perfect perfect-row r" + rank : " r" + rank));
      if (row.perfect) {
        tr.style.background = "rgba(255, 215, 0, 0.18)";
      }

      function countryFlag(name) {
        var map = (typeof TEAM_FLAGS !== "undefined") ? TEAM_FLAGS : {};
        return map[name] || "";
      }
      var chips = isOwnGoalsEntry
        ? row.teams.map(function (t) {
            var flag = countryFlag(t.name);
            var cls = "chip own-goal-chip" + (t.known ? "" : " bad");
            var title = t.known
              ? t.name + " own goal"
              : "Own-goal team not recognised — check spelling against config.js";
            return '<span class="' + cls + '" title="' + escapeHtml(title) + '">' +
                   (flag ? '<span class="flag">' + flag + '</span> ' : '') +
                   escapeHtml(t.name) +
                   '</span>';
          }).join("")
        : row.teams.map(function (t) {
            var cls = "chip" + (t.known ? "" : " bad");
            var title = t.known
              ? (t.matches + " match" + (t.matches === 1 ? "" : "es") + " played"
                 + (t.shootout ? " · incl. " + t.shootout + " shootout" : ""))
              : "Unknown team name — check spelling against config.js";
            return '<span class="' + cls + '" title="' + escapeHtml(title) + '">' +
                   (countryFlag(t.name) ? '<span class="flag">' + countryFlag(t.name) + '</span> ' : '') +
                   escapeHtml(t.name) +
                   ' <span class="stat">P:' + t.matches + '</span>' +
                   ' <span class="g">G:' + t.goals + '</span></span>';
          }).join("");

      tr.innerHTML =
        '<td class="col-rank"><span class="rank-badge">' + badge + '</span></td>' +
        '<td><div class="player-text"><div class="nick-line"><span class="nick">' + escapeHtml(row.nickname) + '</span>' +
          statusBadge + '</div></div></td>' +
        '<td><div class="teams">' + chips + '</div></td>' +
        '<td class="goals-cell"><span class="goals-num">' + row.total + '</span>' +
        '<span class="goals-sub">' + (row.eliminated
          ? "eliminated · >21 goals"
          : (row.perfect ? "perfect · exactly 21 goals" : (row.shootout ? "incl. " + row.shootout + " shootout" : ""))) + '</span></td>' +
        '<td class="played-cell"><span class="played-num">' + (isOwnGoalsEntry ? "" : row.matches) + '</span></td>';
      body.appendChild(tr);
    });

    var warnBox = $("#warnings");
    var uniqueUnknown = unknown.filter(function (v, idx) { return unknown.indexOf(v) === idx; });
    if (uniqueUnknown.length) {
      warnBox.hidden = false;
      warnBox.innerHTML = "<strong>Heads up:</strong> these team names in config.js weren't " +
        "recognised, so they score 0. Check spelling/accents against VALID_TEAM_NAMES: " +
        uniqueUnknown.map(escapeHtml).join(", ") + ".";
    } else {
      warnBox.hidden = true;
    }
  }

  /* Render the most recently played day's matches as normal scorelines. */
  function renderRecent(matches) {
    var section = $("#recent");
    var list = $("#recent-list");
    var titleEl = $("#recent-title");

    var played = matches.filter(function (m) {
      return m.score && m.date && (m.score.et || m.score.ft || m.score.ht);
    });
    if (!played.length) {
      section.hidden = true;
      return;
    }

    var latest = played.reduce(function (max, m) {
      return m.date > max ? m.date : max;
    }, played[0].date);

    var dayMatches = played.filter(function (m) { return m.date === latest; });

    var when = new Date(latest + "T00:00:00");
    var label = isNaN(when.getTime())
      ? latest
      : when.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    titleEl.textContent = "Latest results — " + label;

    list.innerHTML = '<details class="spoiler"><summary>Reveal day\'s matches</summary><ul class="spoiler-list">' +
      dayMatches.map(function (m) {
        var src = m.score.et || m.score.ft || m.score.ht;
        var a = src[0] || 0, b = src[1] || 0;
        var so = (m.score.p && (m.score.p[0] || m.score.p[1]))
          ? ' <span class="so">(pens ' + (m.score.p[0] || 0) + '–' + (m.score.p[1] || 0) + ')</span>'
          : "";
        var aet = m.score.et ? ' <span class="so">(a.e.t.)</span>' : "";
        return '<li class="score">' +
          '<span class="team-a">' + escapeHtml(norm(m.team1)) + '</span>' +
          '<span class="line">' + a + ' <span class="dash">–</span> ' + b + '</span>' +
          '<span class="team-b">' + escapeHtml(norm(m.team2)) + '</span>' +
          aet + so +
          '</li>';
      }).join("") +
      '</ul></details>';

    section.hidden = false;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function load() {
    setStatus("Loading live data…");
    var url = CONFIG.dataUrl + (CONFIG.dataUrl.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now();
    fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        var matches = (data && data.matches) || [];
        var played = matches.filter(function (m) { return m.score; }).length;
        render(tallyTeams(matches), matches);
        renderRecent(matches);
        var when = new Date();
        $("#updated").textContent = "Updated " + when.toLocaleString();
        if (played === 0) {
          setStatus("Connected · no matches scored yet", "live");
        } else {
          setStatus("Live · " + played + " match" + (played === 1 ? "" : "es") + " counted", "live");
        }
      })
      .catch(function (err) {
        setStatus("Couldn't load data (" + err.message + "). Will retry.", "error");
      });
  }

  // Init
  document.title = CONFIG.contestName || document.title;
  $("#contest-title").textContent = CONFIG.contestName || "World Cup 2026 — Goals Contest";
  $("#refresh").addEventListener("click", load);

  // Render configured participants immediately, before the live data request finishes.
  // This prevents any placeholder rows hardcoded in index.html from remaining visible
  // if the football data feed is slow, unavailable, or blocked.
  render({}, []);

  load();
  if (CONFIG.refreshMinutes > 0) {
    setInterval(load, CONFIG.refreshMinutes * 60 * 1000);
  }
})();
