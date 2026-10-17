# Recipients are chosen by `--to`, never by text

`message --to a,b` sends only to those members; without `--to` a message goes to every other member.
The text addresses nobody: an `@handle` in prose, an email, a URL or `@types/bun` is just text. Earlier
designs parsed `@mentions` to decide who is woken; that misfired on `@` in ordinary text and could
stall a 3+ agent conversation when nobody was mentioned.
