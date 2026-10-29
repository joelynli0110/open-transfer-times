// GENERATED FILE — do not edit by hand.
// Source: airports/*.yaml and regions/schengen.yaml. Rebuild with `npm run airports:build`.
(function exposeAirportData(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConnectionQualityAirportData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAirportData() {
  "use strict";
  function deepFreeze(value) {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) deepFreeze(child);
      Object.freeze(value);
    }
    return value;
  }
  return deepFreeze({
    "baseline": {
      "iata": "_baseline",
      "name": "Standard international transfer",
      "lastReviewed": "2026-10-29",
      "allowances": {
        "baseTransfer": {
          "minutes": 35,
          "basis": "heuristic",
          "facts": []
        },
        "passportControl": {
          "minutes": 20,
          "basis": "heuristic",
          "facts": []
        },
        "terminalChange": {
          "minutes": 15,
          "basis": "heuristic",
          "facts": []
        },
        "securityRescreening": {
          "minutes": 0,
          "basis": "heuristic",
          "facts": []
        }
      }
    },
    "airports": {
      "AMS": {
        "iata": "AMS",
        "name": "Amsterdam Schiphol",
        "country": "NL",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 30,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 20,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          },
          "securityRescreening": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          }
        },
        "facts": [],
        "sources": {},
        "coverage": "heuristic"
      },
      "CDG": {
        "iata": "CDG",
        "name": "Paris Charles de Gaulle",
        "country": "FR",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 40,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 25,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 20,
            "basis": "heuristic",
            "facts": []
          },
          "securityRescreening": {
            "minutes": 10,
            "basis": "heuristic",
            "facts": []
          }
        },
        "facts": [],
        "sources": {},
        "coverage": "heuristic"
      },
      "DOH": {
        "iata": "DOH",
        "name": "Doha Hamad",
        "country": "QA",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 30,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          },
          "securityRescreening": {
            "minutes": 10,
            "basis": "heuristic",
            "facts": []
          }
        },
        "facts": [],
        "sources": {},
        "coverage": "heuristic"
      },
      "DXB": {
        "iata": "DXB",
        "name": "Dubai",
        "country": "AE",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 35,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 20,
            "basis": "heuristic",
            "facts": []
          },
          "securityRescreening": {
            "minutes": 10,
            "basis": "heuristic",
            "facts": []
          }
        },
        "facts": [],
        "sources": {},
        "coverage": "heuristic"
      },
      "FRA": {
        "iata": "FRA",
        "name": "Frankfurt",
        "country": "DE",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 35,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 20,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 15,
            "basis": "heuristic",
            "facts": []
          },
          "securityRescreening": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          }
        },
        "facts": [
          {
            "id": "lufthansa-mct-60",
            "claim": "Lufthansa moved its FRA minimum connecting time to a 60-minute standard from 30 March 2025 for intra-European to intra-European connections and Schengen connections to the USA, Singapore and South Africa, ending the earlier 45-50 minute exception.",
            "source": "lufthansa-mct-2024",
            "scope": "Lufthansa-operated connections only"
          }
        ],
        "sources": {
          "lufthansa-mct-2024": {
            "title": "Frankfurt Airport: Increase of the minimum connecting time (MCT) to 60 minutes",
            "publisher": "Lufthansa eXperts",
            "url": "https://irreg.lufthansaexperts.com/en/news/frankfurt-airport-increase-of-the-minimum-connecting-time-mct-to-60-minutes.html",
            "published": "2024-09-10",
            "retrieved": "2026-10-29"
          }
        },
        "coverage": "partial"
      },
      "HKG": {
        "iata": "HKG",
        "name": "Hong Kong",
        "country": "HK",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 30,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 10,
            "basis": "heuristic",
            "facts": []
          },
          "securityRescreening": {
            "minutes": 10,
            "basis": "heuristic",
            "facts": [
              "transfer-security"
            ]
          }
        },
        "facts": [
          {
            "id": "transfer-security",
            "claim": "Transfer passengers go through security screening before heading to the onward boarding gate.",
            "source": "hkg-transfer"
          }
        ],
        "sources": {
          "hkg-transfer": {
            "title": "Transfer & Transit",
            "publisher": "Hong Kong International Airport",
            "url": "https://www.hongkongairport.com/en/passenger-guide/transfer-transit/",
            "retrieved": "2026-10-29"
          }
        },
        "coverage": "partial"
      },
      "HND": {
        "iata": "HND",
        "name": "Tokyo Haneda",
        "country": "JP",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 35,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 20,
            "basis": "heuristic",
            "facts": []
          },
          "securityRescreening": {
            "minutes": 10,
            "basis": "heuristic",
            "facts": []
          }
        },
        "facts": [],
        "sources": {},
        "coverage": "heuristic"
      },
      "ICN": {
        "iata": "ICN",
        "name": "Seoul Incheon",
        "country": "KR",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 30,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 15,
            "basis": "heuristic",
            "facts": []
          },
          "securityRescreening": {
            "minutes": 10,
            "basis": "heuristic",
            "facts": [
              "t1-transfer-security"
            ]
          }
        },
        "facts": [
          {
            "id": "t1-transfer-security",
            "claim": "A Terminal 1 to Terminal 1 transfer consists of transfer security screening followed by boarding.",
            "source": "icn-transfer-t1"
          }
        ],
        "sources": {
          "icn-transfer-t1": {
            "title": "Transfer Stage (Terminal 1)",
            "publisher": "Incheon International Airport",
            "url": "https://www.airport.kr/ap_en/1456/subview.do",
            "retrieved": "2026-10-29"
          }
        },
        "coverage": "partial"
      },
      "IST": {
        "iata": "IST",
        "name": "Istanbul",
        "country": "TR",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 35,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 10,
            "basis": "heuristic",
            "facts": []
          },
          "securityRescreening": {
            "minutes": 10,
            "basis": "heuristic",
            "facts": []
          }
        },
        "facts": [],
        "sources": {},
        "coverage": "heuristic"
      },
      "LHR": {
        "iata": "LHR",
        "name": "London Heathrow",
        "country": "GB",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 40,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 25,
            "basis": "heuristic",
            "facts": [
              "inter-terminal-bus"
            ]
          },
          "securityRescreening": {
            "minutes": 15,
            "basis": "heuristic",
            "facts": [
              "transfer-security"
            ]
          }
        },
        "facts": [
          {
            "id": "transfer-security",
            "claim": "All connecting passengers go through security screening again at Heathrow.",
            "source": "heathrow-connecting"
          },
          {
            "id": "inter-terminal-bus",
            "claim": "Connections between different terminals use a free transfer bus that runs about every 10 minutes.",
            "source": "heathrow-connecting"
          },
          {
            "id": "no-published-mct",
            "claim": "Heathrow does not publish a minimum connection time; travellers are told to check their airline's figure, which does not apply to separately booked flights.",
            "source": "heathrow-connecting"
          }
        ],
        "sources": {
          "heathrow-connecting": {
            "title": "Connecting flights",
            "publisher": "Heathrow Airport",
            "url": "https://www.heathrow.com/connecting-flights",
            "retrieved": "2026-10-29"
          }
        },
        "coverage": "partial"
      },
      "MUC": {
        "iata": "MUC",
        "name": "Munich",
        "country": "DE",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 30,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 20,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 12,
            "basis": "heuristic",
            "facts": []
          },
          "securityRescreening": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          }
        },
        "facts": [],
        "sources": {},
        "coverage": "heuristic"
      },
      "NRT": {
        "iata": "NRT",
        "name": "Tokyo Narita",
        "country": "JP",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 35,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 20,
            "basis": "heuristic",
            "facts": []
          },
          "securityRescreening": {
            "minutes": 10,
            "basis": "heuristic",
            "facts": []
          }
        },
        "facts": [],
        "sources": {},
        "coverage": "heuristic"
      },
      "SIN": {
        "iata": "SIN",
        "name": "Singapore Changi",
        "country": "SG",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 30,
            "basis": "heuristic",
            "facts": []
          },
          "passportControl": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 15,
            "basis": "heuristic",
            "facts": []
          },
          "securityRescreening": {
            "minutes": 10,
            "basis": "heuristic",
            "facts": [
              "transfer-security"
            ]
          }
        },
        "facts": [
          {
            "id": "transfer-security",
            "claim": "Transit passengers go through security screening before heading to the boarding gate of the onward flight.",
            "source": "changi-transit"
          }
        ],
        "sources": {
          "changi-transit": {
            "title": "Transit guide",
            "publisher": "Changi Airport",
            "url": "https://www.changiairport.com/en/fly/transit-guide.html",
            "retrieved": "2026-10-29"
          }
        },
        "coverage": "partial"
      }
    },
    "schengen": {
      "countries": [
        "AT",
        "BE",
        "BG",
        "CH",
        "CZ",
        "DE",
        "DK",
        "EE",
        "ES",
        "FI",
        "FR",
        "GR",
        "HR",
        "HU",
        "IS",
        "IT",
        "LI",
        "LT",
        "LU",
        "LV",
        "MT",
        "NL",
        "NO",
        "PL",
        "PT",
        "RO",
        "SE",
        "SI",
        "SK"
      ],
      "airports": [
        "AMS",
        "ARN",
        "ATH",
        "BCN",
        "BER",
        "BLL",
        "BRU",
        "BUD",
        "CDG",
        "CPH",
        "DUS",
        "FCO",
        "FRA",
        "GVA",
        "HAM",
        "HEL",
        "KEF",
        "LIS",
        "LYS",
        "MAD",
        "MUC",
        "MXP",
        "NAP",
        "NCE",
        "OSL",
        "PRG",
        "RIX",
        "STR",
        "TLL",
        "VCE",
        "VIE",
        "WAW",
        "ZRH"
      ],
      "nonSchengenAirports": [
        "ATL",
        "BKK",
        "BOS",
        "DEL",
        "DOH",
        "DXB",
        "EWR",
        "HKG",
        "HND",
        "ICN",
        "IST",
        "JFK",
        "LAX",
        "LHR",
        "NRT",
        "ORD",
        "PEK",
        "PVG",
        "SEA",
        "SFO",
        "SIN",
        "SYD",
        "YYZ"
      ],
      "source": {
        "title": "Schengen",
        "publisher": "Swiss State Secretariat for Migration (SEM)",
        "url": "https://www.sem.admin.ch/sem/en/home/themen/einreise/fachinfo-einreise/schengen.html",
        "note": "Page lists 29 Schengen member states (last modified 12.10.2025). Cyprus and Ireland are EU members outside Schengen.",
        "retrieved": "2026-10-29"
      }
    }
  });
});
