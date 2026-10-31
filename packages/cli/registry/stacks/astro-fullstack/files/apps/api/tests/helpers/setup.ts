// Setup runs before application imports. Tests never inherit credentials or .env.
for (const key of Object.keys(process.env)) {
  if (/TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|ACCESS_KEY|AUTH/i.test(key))
    delete process.env[key];
}
