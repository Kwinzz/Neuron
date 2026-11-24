import type { Message } from "../index";

/** Namespace « home » — French (source of truth). */
const home = {
  // ActiveThreadsCard
  activeTitle: "En cours",
  activeCount: (v) => (Number(v.n) <= 1 ? `${v.n} chat actif` : `${v.n} chats actifs`),
  activeEmptyTitle: "Aucun agent en cours",
  activeEmptyBody: "Lance un chat pour le suivre ici.",
  // AgentTotals
  agentsShown: "Agents affichés",
  showAgent: "Afficher {agent}",
  hideAgent: "Masquer {agent}",
  // CacheCard
  cacheTitle: "Efficacité du cache",
  cacheReadLabel: "Lecture cache",
  cacheRateAria: "Taux de lecture cache : {pct}",
  cacheNoData: "Aucune donnée de cache",
  cacheReadCaption: "lecture cache",
  cacheRead: "Cache lu",
  cacheWritten: "Cache écrit",
  // ConsumptionCard
  consumptionTitle: "Consommation",
  costHint: "Au tarif API : Claude tel que communiqué, Codex et Antigravity estimés depuis les tokens",
  consumptionPeak: "pic {when} ({value})",
  metricAria: "Mesure affichée",
  rangeAria: "Période de consommation",
  rangeDay: "Jour",
  range7d: "7 jours",
  range30d: "30 jours",
  viewChart: "Graphique",
  viewTable: "Tableau",
  consumptionEmptyCost: "Aucun coût sur cette période",
  consumptionEmpty: "Aucune consommation sur cette période",
  consumptionEmptyBody: "L'usage de Claude Code et de Codex (terminal compris) apparaît ici dès leur prochaine réponse.",
  // DashboardError
  loadErrorTitle: "Impossible de charger le tableau de bord",
  // DeltaBadge
  deltaNoPrevious: "Pas de période précédente comparable",
  deltaVsPrevious: "par rapport à la période précédente",
  // ProjectsCard
  byProjectTitle: "Par projet",
  byProjectEmpty: "Aucune donnée par projet",
  projectShareAria: "Part du projet {name}",
  // QuotaBar / ResetCountdown
  resetIn: "reset dans",
  resetInShort: "Réinit. dans",
  // QuotaEditor
  quotaErrLabel: "Le libellé est requis.",
  quotaErrLimit: "La limite doit être un nombre positif ou nul.",
  quotaErrPct: "Le seuil d'alerte doit être compris entre 1 et 100 %.",
  quotaConfigure: "Configurer {name}",
  quotaLabel: "Libellé",
  quotaPlan: "Abonnement",
  quotaPlanPlaceholder: "Max, Pro, API…",
  quotaWindow: "Fenêtre",
  quotaUnit: "Unité",
  quotaLimit: "Limite",
  quotaLimitNone: "Aucune",
  quotaAlertPct: "Seuil d'alerte (%)",
  saving: "Enregistrement…",
  // QuotaRow
  quotaBarAria: "Quota {name}",
  quotaExceeded: "Quota dépassé",
  quotaAlertReached: "Seuil d'alerte atteint",
  quotaReportedBy: "Utilisation rapportée par {agent}",
  quotaReportedByGroup: "Utilisation rapportée par {agent} (groupe le plus utilisé : {group})",
  quotaSubscriptionSource: "Abonnement · source {agent}",
  quotaNoLimit: "Aucune limite définie ·",
  quotaConfigureShort: "Configurer",
  // QuotasCard
  quotasTitle: "Quotas & abonnements",
  providerCount: (v) => (Number(v.n) <= 1 ? `${v.n} fournisseur` : `${v.n} fournisseurs`),
  quotasEmpty: "Aucun fournisseur configuré",
  // RecentThreadRow / RecentThreadsCard
  openChatAria: "Ouvrir {title}",
  noProject: "Sans projet",
  recentTitle: "Chats récents",
  recentChatCount: (v) => (Number(v.n) <= 1 ? `${v.n} chat` : `${v.n} chats`),
  recentDoneCount: (v) => (Number(v.n) <= 1 ? `${v.n} terminé` : `${v.n} terminés`),
  recentEmptyTitle: "Aucun chat récent",
  recentEmptyBody: "Les chats terminés apparaîtront ici.",
  colChat: "Chat",
  colAgent: "IA",
  colStatus: "Statut",
  colTokens: "Tokens",
  colUpdated: "Mis à jour",
  // SectionCards
  kpiInput: "Tokens entrée",
  kpiInputHint: "Prompts et contexte envoyés (hors cache)",
  kpiOutput: "Tokens sortie",
  kpiOutputHint: "Réponses générées par les agents",
  kpiCost: "Coût total",
  kpiCostHint: "Tous fournisseurs, au tarif API : Claude tel que communiqué, Codex et Antigravity estimés depuis les tokens",
  kpiTotal: "Tokens au total",
  kpiTotalHint: "Tous fournisseurs : entrée, sortie, lectures et écritures de cache",
  // UsageTable / UsageTooltip
  tableCaption: "Consommation par période",
  colPeriod: "Période",
  total: "Total",
  tooltipNoActivity: "Aucune activité",
  // quotaFormat
  window5h: "Fenêtre 5h",
  windowCumulative: "Cumul",
  credits: "Crédits",
  unitTokens: "Tokens",
  unitMessages: "Messages",
  unitRequests: "Requêtes",
  // rangeLabel
  rangeToday: "Aujourd'hui",
  rangeLast7: "7 derniers jours",
  rangeLast30: "30 derniers jours",
  // usageMetric
  metricTokens: "Tokens",
  metricTokensUnit: "tokens (cache compris)",
  metricCost: "Coût",
  metricTurns: "Requêtes",
  metricTurnsUnit: "requêtes",
} satisfies Record<string, Message>;

export default home;
