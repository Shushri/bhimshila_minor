# BhimShila

## Disaster Intelligence, Preparedness and Coordination Platform for India

BhimShila is an integrated disaster management platform designed to connect government disaster alerts, citizen distress reports, risk assessment and on-ground response coordination through a single system.

It collects official disaster warnings, prioritises them based on the population potentially affected, accepts citizen SOS reports in Hindi, English and Hinglish, and helps coordinators manage response teams and relief operations.

The project is named after the large boulder that came to rest behind Kedarnath Temple during the June 2013 floods. It diverted the debris flow and helped protect the temple and people sheltering inside. BhimShila takes inspiration from this event and aims to make disaster preparedness and response more organised, accessible and timely.

---

## 1. Problem Statement

India has an established disaster monitoring infrastructure. Organisations such as the India Meteorological Department (IMD) and Central Water Commission (CWC) provide weather and flood-related information, while NDMA's [Sachet Portal](https://sachet.ndma.gov.in/) publishes Common Alerting Protocol (CAP 1.2) warnings from multiple agencies.

However, disaster information is often distributed across different platforms and channels.

During an ordinary monsoon day, dozens of alerts may be active simultaneously. These warnings are presented without a clear indication of how many people are potentially affected by each alert. As a result, coordinators may have to manually assess and prioritise warnings.

At the same time, citizens report emergencies through phone calls and messages, often using Hinglish or informal language. These distress reports may remain disconnected from official alerts and response operations.

For example, on 26 June 2025, a flash flood occurred near Khaniyara in the Dharamshala region. Despite a red alert being in force for the wider Kangra district, a district-level warning could not communicate the exact risk faced by individual communities near vulnerable streams.

**The central problem is the gap between official disaster warnings and coordinated action at the affected location.**

## 2. Proposed Solution

BhimShila provides a common platform for disaster information, citizen assistance and response coordination.

| Module                          | Functionality                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Alert Ingestion**             | Collects official NDMA Sachet CAP 1.2 alerts and integrates weather information from Open-Meteo, earthquake data from USGS and news feeds.              |
| **Population-Based Ranking**    | Estimates the population potentially affected by each alert using Census data and ranks warnings based on severity and population exposure.             |
| **Weather Verification**        | Compares official alerts with independently collected weather information and highlights discrepancies.                                                 |
| **AI Assistant**                | Accepts typed and spoken queries, including Hinglish, and provides disaster-related information through a tool-based assistant.                         |
| **Location-Based Analysis**     | Provides state-level drill-downs with alerts, risk information, forecasts, historical rainfall, news, population exposure and deployment details.       |
| **Notification System**         | Delivers official alerts through Telegram and in-app notifications while tracking delivery status for each channel.                                     |
| **SOS and Incident Management** | Processes citizen distress reports, groups related reports into incidents and organises them into a priority queue.                                     |
| **Field Team Coordination**     | Supports team assignment, volunteer acceptance, deployment tracking, mission chat, photo reports and broadcast requests.                                |
| **Offline Support**             | Keeps essential shelter information available offline and queues SOS reports, missions and field reports for synchronisation when connectivity returns. |

## 3. Core Design Principle: Deterministic Safety Decisions

A central design principle of BhimShila is:

**AI processes language, but it does not independently decide who is in danger or who receives help first.**

Risk calculations, severity thresholds, population exposure and alert ranking are handled by deterministic code with defined and readable rules.

AI is used for language understanding, information extraction and assistance. It does not generate the numerical risk scores or independently override life-safety decisions.

For example, consider the Hinglish message:

*"Paani ghar mein ghus gaya, chhat pe phase hain."*

This message describes people trapped on a roof due to rising water. During testing, an AI model incorrectly classified it as a shelter request with severity 4.

The keyword-based parser correctly identified it as a rescue emergency. BhimShila uses a reconciliation mechanism in which the deterministic parser protects critical categories, and the final severity cannot be lower than the keyword-based severity.

This approach reduces the risk of incorrect AI interpretation in emergency situations and makes important decisions easier to audit.

## 4. Key Features

### 4.1 Real-Time Disaster Alert Monitoring

- Integrates the NDMA Sachet CAP 1.2 alert feed.
- Uses ETag-based caching to avoid unnecessary repeated downloads.
- Detects duplicate alerts and tracks changes in alert severity.
- Monitors weather information across 724 districts.
- Integrates earthquake information and news feeds.

### 4.2 Population-Weighted Risk Assessment

- Uses Census of India 2011 population and density information.
- Applies population projections for 2026.
- Considers alert severity and population exposure.
- Uses additional geographical and environmental factors in risk assessment.
- Produces a ranked list of active warnings.

### 4.3 Hinglish-Based SOS Processing

- Accepts distress messages in Hindi, English and Hinglish.
- Uses keyword matching and AI-assisted language processing.
- Extracts relevant information such as location, emergency type and number of affected people.
- Groups multiple reports related to the same incident.
- Prioritises critical rescue and medical emergencies.

### 4.4 AI-Powered Disaster Assistant

- Supports text and voice-based interaction.
- Understands disaster-related queries in Hinglish.
- Uses a deterministic intent router to identify the appropriate operation.
- Invokes relevant tools for information retrieval and analysis.
- Can operate without an external model key for supported deterministic queries.

### 4.5 Location-Based Disaster Dashboard

Selecting a state provides access to multiple information panels, including:

- Official alerts in the issuing authority's original language.
- Disaster risk information.
- 72-hour weather forecasts.
- Historical rainfall comparison using an 86-year baseline.
- News and population exposure.
- Relief resources and field deployments.
- Live weather information.

### 4.6 Field Response and Coordination

- SOS reports are converted into manageable incidents.
- Coordinators can assign missions to nearby response teams.
- Volunteers can accept and update mission status.
- Teams can communicate through mission-specific chat.
- Field personnel can submit photographs and ground reports.
- Broadcast requests require coordinator approval.

### 4.7 Offline-First Resilience

- Bundled geographical and shelter information supports offline access.
- SOS, mission and field-report operations can be queued locally.
- Queued operations synchronise when connectivity is restored.
- Multiple AI providers support automatic failover.
- The platform communicates reduced functionality instead of presenting unavailable services as operational.

## 5. Data Sources

The platform uses publicly available datasets and services wherever possible.

| Source                                                        | Purpose                                           |
| ------------------------------------------------------------- | ------------------------------------------------- |
| [NDMA Sachet](https://sachet.ndma.gov.in/)                    | Official CAP 1.2 disaster alerts                  |
| [Open-Meteo](https://open-meteo.com/)                         | Weather forecasts and historical rainfall data    |
| Census of India 2011                                          | District population and density information       |
| [Humanitarian Data Exchange (HDX)](https://data.humdata.org/) | 4,275 shelter locations                           |
| OpenStreetMap Overpass API                                    | Waterway and geographical proximity information   |
| [USGS](https://earthquake.usgs.gov/)                          | Earthquake information                            |
| The Hindu, NDTV and PIB                                       | News-based disaster information and corroboration |

The platform uses historical rainfall information to compare current rainfall conditions against long-term patterns. Shelter information is bundled to support offline access.

## 6. Technology Stack

| Component              | Technology                                       |
| ---------------------- | ------------------------------------------------ |
| Frontend and Framework | Next.js 16, React 19                             |
| Programming Language   | TypeScript                                       |
| Styling                | Tailwind CSS v4                                  |
| Database               | SQLite / libSQL                                  |
| Production Database    | Turso                                            |
| Authentication         | scrypt password hashing and server-side sessions |
| Maps                   | SVG-based map with bundled GeoJSON               |
| AI Integration         | OpenAI-compatible LLM client                     |
| AI Providers           | Sarvam AI, OpenRouter, Groq and Gemini           |
| Notifications          | Telegram Bot API and in-app notification centre  |

The application uses a local SQLite database during development and supports Turso for production deployment through the libSQL client. The map is built using SVG and bundled GeoJSON rather than relying on an external map tile server.

## 7. Running the Project Locally

### Prerequisites

- Node.js and npm
- Git
- Optional API keys for external AI and notification services

### Installation

```bash
git clone <repository-url>
cd bhimshila_minor
npm install
```

Create the environment configuration file:

```bash
cp .env.local.example .env
```

Add the required configuration values where applicable, then start the development server:

```bash
npm run dev
```

Open the application at:

[http://localhost:3000](http://localhost:3000)

**Note:** The platform supports deterministic functionality without AI model keys. External model keys enable additional AI capabilities, while a Telegram bot token is needed for Telegram alert delivery. A Turso database URL is required only when using the production database.

### Environment Variables

| Variable             | Purpose                                     |
| -------------------- | ------------------------------------------- |
| `OPENROUTER_API_KEY` | AI assistant integration                    |
| `GROQ_API_KEY`       | AI provider and failover                    |
| `GEMINI_API_KEY`     | AI provider failover and voice capabilities |
| `TELEGRAM_BOT_TOKEN` | Telegram notifications                      |
| `DATABASE_URL`       | Production database connection              |

Each environment variable should be placed on a separate line in the environment file. Avoid adding inline comments to secret values.

## 8. Testing and Validation

BhimShila includes an automated test suite consisting of **400+ checks across 15 test suites**.

The tests cover important application workflows and failure scenarios, including:

- Alert ingestion and duplicate detection.
- Risk assessment and ranking logic.
- SOS classification and severity reconciliation.
- AI assistant routing and tool selection.
- Database operations and mission management.
- Notification and broadcast approval workflows.
- Offline queue and synchronisation behaviour.

Testing also helped identify a database argument-ordering issue that could have allowed a broadcast request to be approved more than once. This demonstrates the importance of validating not only normal workflows but also critical failure scenarios.

Run the tests using:

```bash
npm test
```

## 9. Future Scope

The platform can be extended through the following improvements:

1. **SMS and IVRS Integration:** Provide emergency reporting and alert delivery to people without smartphones or reliable internet access.
2. **Government System Integration:** Establish direct integrations with State Disaster Management Authorities and other official systems.
3. **Multilingual Support:** Extend citizen interaction to languages such as Tamil, Bengali, Telugu and Odia.
4. **Predictive Risk Modelling:** Incorporate elevation, soil saturation and historical flood patterns to improve pre-disaster risk estimation.
5. **Drone and Satellite Integration:** Support automated damage assessment using aerial and satellite imagery.
6. **Government Coordination Dashboard:** Provide district-level dashboards and structured reporting for administrative authorities.
7. **Inter-District Coordination:** Enable response teams and coordinators to collaborate across district boundaries.

## 10. Conclusion

BhimShila brings together official disaster alerts, population-based risk assessment, citizen SOS processing and field-team coordination in a unified platform.

Its key contribution is connecting broad disaster warnings with location-specific population exposure and response operations. By combining deterministic risk assessment, Hinglish-based citizen interaction, AI-assisted information processing and offline support, the platform aims to make disaster response more organised, accessible and reliable.

The project demonstrates how publicly available disaster information, modern web technologies and carefully controlled AI integration can be combined to support disaster preparedness and emergency coordination.
