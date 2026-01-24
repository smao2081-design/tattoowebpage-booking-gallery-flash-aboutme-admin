const nodemailer = require('nodemailer');

async function make() {
  try {
    const account = await nodemailer.createTestAccount();
    console.log('ETHEREAL_JSON:' + JSON.stringify(account));
    console.log(`SMTP_HOST=${account.smtp.host}`);
    console.log(`SMTP_PORT=${account.smtp.port}`);
    console.log(`SMTP_SECURE=${account.smtp.secure}`);
    console.log(`SMTP_USER=${account.user}`);
    console.log(`SMTP_PASS=${account.pass}`);
  } catch (err) {
    console.error('ERR', err);
    process.exit(1);
  }
}

make();
