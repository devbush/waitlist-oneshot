/** Règles des plans, partagées par la base, le serveur et les vues. */
export const FREE_LIMIT = 100; // inscrits par compte, toutes listes confondues
export const PRO_PRICE_EUR = 9; // par mois

// past_due : Stripe relance le paiement pendant quelques jours, on garde l'accès en attendant.
const PRO_STATUSES = new Set(['active', 'trialing', 'past_due']);
export const isPro = (user) => PRO_STATUSES.has(user?.subscription_status);

// Parrainage : nombre de places gagnées dans la liste pour chaque ami parrainé.
export const REFERRAL_BOOST = 5;
