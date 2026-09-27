// Tolkien quotes for the start page (Inv §3.2): one at random per page
// load. Our own selection (ADR 0010: not Cockpit's file), quoted from
// The Hobbit and The Lord of the Rings.

export interface Quote {
  text: string;
  by: string;
}

export const QUOTES: readonly Quote[] = [
  { text: 'Not all those who wander are lost.', by: 'Bilbo Baggins' },
  { text: 'All we have to decide is what to do with the time that is given us.', by: 'Gandalf' },
  { text: 'Even the very wise cannot see all ends.', by: 'Gandalf' },
  { text: "It's a dangerous business, Frodo, going out of your door.", by: 'Bilbo Baggins' },
  { text: 'Faithless is he that says farewell when the road darkens.', by: 'Gimli' },
  { text: 'Courage is found in unlikely places.', by: 'Gildor Inglorion' },
  { text: 'The Road goes ever on and on.', by: 'Bilbo Baggins' },
  { text: 'Many that live deserve death. And some that die deserve life.', by: 'Gandalf' },
  { text: 'Deeds will not be less valiant because they are unpraised.', by: 'Aragorn' },
  { text: 'I will not say: do not weep; for not all tears are an evil.', by: 'Gandalf' },
  {
    text: 'If more of us valued food and cheer and song above hoarded gold, it would be a merrier world.',
    by: 'Thorin Oakenshield',
  },
  { text: 'Do not meddle in the affairs of Wizards, for they are subtle and quick to anger.', by: 'Gildor Inglorion' },
  { text: 'Go not to the Elves for counsel, for they will say both no and yes.', by: 'Frodo Baggins' },
  { text: 'The burned hand teaches best.', by: 'Gandalf' },
  { text: 'Despair is only for those who see the end beyond all doubt.', by: 'Gandalf' },
  { text: 'In a hole in the ground there lived a hobbit.', by: 'The Hobbit' },
  { text: 'He that breaks a thing to find out what it is has left the path of wisdom.', by: 'Gandalf' },
  { text: 'Never laugh at live dragons, Bilbo you fool!', by: 'Bilbo Baggins' },
  {
    text: 'The wide world is all about you: you can fence yourselves in, but you cannot for ever fence it out.',
    by: 'Gildor Inglorion',
  },
  { text: 'The world is indeed full of peril, and in it there are many dark places.', by: 'Haldir' },
  { text: 'There is more in you of good than you know, child of the kindly West.', by: 'Thorin Oakenshield' },
];

/** A random quote. */
export function randomQuote(rand: () => number = Math.random): Quote {
  return QUOTES[Math.floor(rand() * QUOTES.length) % QUOTES.length]!;
}
