import * as db from './db.js';
import * as stripe from './stripe.js';

/**
 * Relit l'abonnement chez Stripe et enregistre son état.
 * On relit toujours la source de vérité plutôt que de faire confiance au contenu de l'événement :
 * les webhooks peuvent arriver en double ou dans le désordre.
 */
export async function syncSubscription(subscriptionId) {
  const sub = await stripe.getSubscription(subscriptionId);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  // Le client Stripe est créé par nous et rattaché au compte : c'est le lien de confiance.
  const user = db.getUserByCustomer(customerId);
  if (!user) {
    console.warn(`Stripe : abonnement ${sub.id} pour un client inconnu (${customerId}), ignoré.`);
    return null;
  }
  // Un ancien abonnement terminé ne doit pas écraser un abonnement actif plus récent.
  if (user.stripe_subscription_id && user.stripe_subscription_id !== sub.id && db.isPro(user) && !db.isPro({ subscription_status: sub.status })) {
    return user;
  }
  db.saveSubscription(user.id, stripe.subscriptionState(sub));
  return db.getUserById(user.id);
}

/** Événements Stripe traités par le webhook. */
export async function handleEvent(event) {
  const obj = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (obj.mode === 'subscription' && obj.subscription) await syncSubscription(obj.subscription);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      await syncSubscription(obj.id);
      break;
    default:
      // Autres événements : rien à faire (on répond 200 pour que Stripe ne réessaie pas).
      break;
  }
}

/** Au retour de Checkout, on synchronise tout de suite au cas où le webhook n'est pas encore arrivé. */
export async function syncFromCheckout(user, sessionId) {
  const session = await stripe.getCheckoutSession(sessionId);
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (!customerId || customerId !== user.stripe_customer_id) return null; // session d'un autre compte : on ignore
  if (session.subscription) {
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    return syncSubscription(subId);
  }
  return null;
}

/** Renvoie l'identifiant client Stripe du compte, en le créant au besoin. */
export async function ensureCustomer(user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await stripe.createCustomer(user);
  db.setStripeCustomer(user.id, customer.id);
  return customer.id;
}
