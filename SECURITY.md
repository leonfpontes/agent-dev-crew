# Security

Found a vulnerability? Please do not open a public issue. Email contato@leopontes.com.br
with the steps to reproduce. You will get an answer within 5 business days.

Code written by the agents runs in a child process with no environment variables, no network
and access only to a throwaway copy of the example repository. The public demo replays
recorded runs: it calls no model and stores nothing.
