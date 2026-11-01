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
        "timezone": "Europe/Amsterdam",
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
            "facts": [
              "schengen-passport-control"
            ]
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
        "facts": [
          {
            "id": "schengen-passport-control",
            "claim": "Passengers transferring between a Schengen and a non-Schengen flight go through passport control again.",
            "source": "schiphol-transfer-blog"
          },
          {
            "id": "conditional-security",
            "claim": "Transfer passengers arriving from the US, Canada, the UK, Ireland, Singapore, Cyprus, a Schengen country or Belgrade do not need to be screened again; Schengen to non-Schengen transfers may also require screening depending on origin and destination.",
            "source": "schiphol-transfer-blog"
          }
        ],
        "sources": {
          "schiphol-transfer-blog": {
            "title": "All about your transfer at Schiphol",
            "publisher": "Amsterdam Airport Schiphol",
            "url": "https://www.schiphol.nl/en/blog/all-about-your-transfer-at-schiphol",
            "published": "2023-12-04",
            "retrieved": "2026-10-29"
          }
        },
        "coverage": "partial"
      },
      "CDG": {
        "iata": "CDG",
        "name": "Paris Charles de Gaulle",
        "country": "FR",
        "timezone": "Europe/Paris",
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
        "facts": [
          {
            "id": "connection-route-checks",
            "claim": "Connecting passengers follow the signed connection route and pass any applicable border-formality or security checks on the way to the gate.",
            "source": "airfrance-cdg-connections",
            "scope": "Air France connections at Paris airports"
          },
          {
            "id": "short-connection-pass",
            "claim": "Air France offers a short-connection pass at CDG intended to speed passengers with short connections through the checks.",
            "source": "airfrance-cdg-connections",
            "scope": "Air France connections"
          }
        ],
        "sources": {
          "airfrance-cdg-connections": {
            "title": "Contrôles, parcours, bagages : votre correspondance à l'aéroport Paris-Charles de Gaulle",
            "publisher": "Air France",
            "url": "https://wwws.airfrance.fr/information/aeroport/conseils-correspondances-paris-cdg-ory",
            "retrieved": "2026-10-29",
            "note": "The Paris Aéroport operator site did not yield a citable connection page; replace with an operator source when found."
          }
        },
        "coverage": "partial"
      },
      "DOH": {
        "iata": "DOH",
        "name": "Doha Hamad",
        "country": "QA",
        "timezone": "Asia/Qatar",
        "lastReviewed": "2026-10-29",
        "allowances": {
          "baseTransfer": {
            "minutes": 30,
            "basis": "heuristic",
            "facts": [
              "transfer-hall-walking-times"
            ]
          },
          "passportControl": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          },
          "terminalChange": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": [
              "single-terminal"
            ]
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
            "id": "single-terminal",
            "claim": "Passengers arrive, transfer and depart in the same terminal building.",
            "source": "hia-transfers"
          },
          {
            "id": "transfer-security",
            "claim": "Transfer passengers' hand baggage is security screened before they can enter the passenger terminal.",
            "source": "hia-transfers"
          },
          {
            "id": "transfer-hall-walking-times",
            "claim": "Walking times from the transfer halls to the departure concourses range from about 1 to 14 minutes.",
            "source": "hia-transfers"
          },
          {
            "id": "gate-closure",
            "claim": "Boarding gates close 20 minutes before the flight's departure time.",
            "source": "hia-transfers"
          }
        ],
        "sources": {
          "hia-transfers": {
            "title": "Transfers",
            "publisher": "Hamad International Airport",
            "url": "https://dohahamadairport.com/airport-guide/at-the-airport/transfers",
            "retrieved": "2026-10-29"
          }
        },
        "coverage": "partial"
      },
      "DXB": {
        "iata": "DXB",
        "name": "Dubai",
        "country": "AE",
        "timezone": "Asia/Dubai",
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
        "facts": [
          {
            "id": "separate-ticket-recheck",
            "claim": "Passengers on separate tickets who do not need a visa (or hold a Dubai visa) must clear passport control, collect their bags and check in again for the connecting flight.",
            "source": "dxb-transfers"
          },
          {
            "id": "airport-trains",
            "claim": "Terminal 1 D gates and Terminal 3 A gates are reached by a short airport train ride; Terminal 3 B and C gates are connected on foot.",
            "source": "dxb-transfers"
          }
        ],
        "sources": {
          "dxb-transfers": {
            "title": "Transfers",
            "publisher": "Dubai Airports",
            "url": "https://dubaiairports.ae/information/transfers",
            "retrieved": "2026-10-29"
          }
        },
        "coverage": "partial"
      },
      "FRA": {
        "iata": "FRA",
        "name": "Frankfurt",
        "country": "DE",
        "timezone": "Europe/Berlin",
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
            "scope": "Lufthansa-operated intra-European connections and Schengen connections to the USA, Singapore and South Africa"
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
        "timezone": "Asia/Hong_Kong",
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
        "timezone": "Asia/Tokyo",
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
            "facts": [
              "international-transit-bus"
            ]
          },
          "securityRescreening": {
            "minutes": 10,
            "basis": "heuristic",
            "facts": [
              "transit-security-checkpoint"
            ]
          }
        },
        "facts": [
          {
            "id": "international-transit-bus",
            "claim": "International-to-international transfers between Terminal 2 and Terminal 3 use a dedicated international transit bus.",
            "source": "hnd-int-int"
          },
          {
            "id": "transit-security-checkpoint",
            "claim": "Passengers arriving at Terminal 3 on the transit bus are guided to the international transit security checkpoint.",
            "source": "hnd-int-int"
          }
        ],
        "sources": {
          "hnd-int-int": {
            "title": "International to International",
            "publisher": "Tokyo International Airport (Haneda)",
            "url": "https://tokyo-haneda.com/en/flight/transit/int_int.html",
            "retrieved": "2026-10-29"
          }
        },
        "coverage": "partial"
      },
      "ICN": {
        "iata": "ICN",
        "name": "Seoul Incheon",
        "country": "KR",
        "timezone": "Asia/Seoul",
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
        "timezone": "Europe/Istanbul",
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
            "facts": [
              "single-ticket-no-passport"
            ]
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
        "facts": [
          {
            "id": "single-ticket-no-passport",
            "claim": "Passengers on a single-ticket connection from one international flight to another do not go through further passport procedures and proceed to the boarding gate.",
            "source": "turkish-transfer-faq",
            "scope": "Single-ticket connections involving Turkish Airlines"
          }
        ],
        "sources": {
          "turkish-transfer-faq": {
            "title": "Transfer and transit passengers",
            "publisher": "Turkish Airlines",
            "url": "https://www.turkishairlines.com/en-br/any-questions/transfer-transit-passengers",
            "retrieved": "2026-10-29",
            "note": "The istairport.com transfer guide could not be retrieved; replace with an operator source when available."
          }
        },
        "coverage": "partial"
      },
      "LHR": {
        "iata": "LHR",
        "name": "London Heathrow",
        "country": "GB",
        "timezone": "Europe/London",
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
        "timezone": "Europe/Berlin",
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
            "facts": [
              "schengen-passport-control"
            ]
          },
          "terminalChange": {
            "minutes": 12,
            "basis": "heuristic",
            "facts": [
              "inter-terminal-bus"
            ]
          },
          "securityRescreening": {
            "minutes": 0,
            "basis": "heuristic",
            "facts": []
          }
        },
        "facts": [
          {
            "id": "schengen-passport-control",
            "claim": "Passport control is required when transferring between Schengen and non-Schengen flights; it is usually not required for Schengen to Schengen or for non-Schengen to non-Schengen transfers that stay in the gate area.",
            "source": "muc-connecting"
          },
          {
            "id": "conditional-security",
            "claim": "Transfer passengers need to pass security control in some cases.",
            "source": "muc-connecting"
          },
          {
            "id": "inter-terminal-bus",
            "claim": "A free shuttle bus links Terminal 1 and Terminal 2; the ride takes 5 to 7 minutes, running every 10 minutes from 7 a.m. to 5 p.m. and every 20 minutes early morning and evening.",
            "source": "muc-connecting"
          },
          {
            "id": "satellite-train",
            "claim": "Terminal 2 and the Terminal 2 Satellite are linked by an underground shuttle train that runs every 4 minutes and takes about 1 minute.",
            "source": "muc-connecting"
          }
        ],
        "sources": {
          "muc-connecting": {
            "title": "Connecting flights",
            "publisher": "Munich Airport",
            "url": "https://www.munich-airport.com/connecting-flights-260553",
            "retrieved": "2026-10-29"
          }
        },
        "coverage": "partial"
      },
      "NRT": {
        "iata": "NRT",
        "name": "Tokyo Narita",
        "country": "JP",
        "timezone": "Asia/Tokyo",
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
            "facts": [
              "inter-terminal-bus"
            ]
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
            "claim": "Connecting passengers already screened at their departure airport must, with some exceptions, be screened again in Japan, including a baggage inspection and body check.",
            "source": "nrt-security-connection"
          },
          {
            "id": "inter-terminal-bus",
            "claim": "Passengers changing terminals take a shuttle bus; approximate rides are T1→T2 8–12 min, T1→T3 12–16 min, T2→T1 12–16 min, T2→T3 about 4 min, T3→T1 24–28 min and T3→T2 about 12 min.",
            "source": "nrt-inter-inter"
          },
          {
            "id": "operating-hours",
            "claim": "Aircraft operate at Narita only between 06:00 and 24:00, and passengers cannot stay airside outside those hours.",
            "source": "nrt-inter-inter"
          }
        ],
        "sources": {
          "nrt-security-connection": {
            "title": "Why is security screening required for connecting flights?",
            "publisher": "Narita International Airport",
            "url": "https://www.narita-airport.jp/en/airportguide/security/connection/",
            "retrieved": "2026-10-29"
          },
          "nrt-inter-inter": {
            "title": "Connection between international flights",
            "publisher": "Narita International Airport",
            "url": "https://www.narita-airport.jp/en/airportguide/connect/inter-inter/",
            "retrieved": "2026-10-29"
          }
        },
        "coverage": "partial"
      },
      "SIN": {
        "iata": "SIN",
        "name": "Singapore Changi",
        "country": "SG",
        "timezone": "Asia/Singapore",
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
