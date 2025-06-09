import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Add GET / route to prevent "Cannot GET /"
app.get('/', (req: Request, res: Response) => {
  res.send(`
    <h2>Server is running!</h2>
    <p>Try making a <code>POST</code> request to <code>/identify</code>.</p>
    <p>Example request body:</p>
    <pre>
{
  "email": "someone@example.com",
  "phoneNumber": "1234567890"
}
    </pre>
  `);
});

app.post('/identify', async (req: Request, res: Response) => {
  try {
    const { email, phoneNumber } = req.body;

    if (!email && !phoneNumber) {
      return res.status(400).json({ error: 'Email or phoneNumber is required' });
    }

    // Step 1: Find all existing matching contacts
    const existingContacts = await prisma.contact.findMany({
      where: {
        OR: [
          email ? { email } : undefined,
          phoneNumber ? { phoneNumber } : undefined,
        ].filter(Boolean) as any,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Step 2: Determine primary contact
    let primaryContact = existingContacts.find(c => c.linkPrecedence === 'primary') || existingContacts[0];

    if (!primaryContact && (email || phoneNumber)) {
      // If no contact exists, create a new primary contact
      primaryContact = await prisma.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: 'primary',
        },
      });
    } else if (primaryContact) {
      // Merge multiple primary contacts if found
      const primaryContacts = existingContacts.filter(c => c.linkPrecedence === 'primary');
      for (const contact of primaryContacts) {
        if (contact.id !== primaryContact.id) {
          await prisma.contact.update({
            where: { id: contact.id },
            data: {
              linkPrecedence: 'secondary',
              linkedId: primaryContact.id,
            },
          });
        }
      }

      // Check for duplicate entry
      const isExactDuplicate = existingContacts.some(
        c => c.email === email && c.phoneNumber === phoneNumber
      );

      if (!isExactDuplicate && (email || phoneNumber)) {
        const existsWithEmail = existingContacts.some(c => c.email === email);
        const existsWithPhone = existingContacts.some(c => c.phoneNumber === phoneNumber);

        // Only insert a new contact if this combo is unique
        if (!existsWithEmail || !existsWithPhone) {
          await prisma.contact.create({
            data: {
              email,
              phoneNumber,
              linkPrecedence: 'secondary',
              linkedId: primaryContact.id,
            },
          });
        }
      }
    }

    // Step 3: Refetch all related contacts (primary + secondaries)
    const relatedContacts = await prisma.contact.findMany({
      where: {
        OR: [
          { id: primaryContact.id },
          { linkedId: primaryContact.id },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    const uniqueEmails = Array.from(
      new Set(relatedContacts.map(c => c.email).filter((e): e is string => !!e))
    );
    const uniquePhones = Array.from(
      new Set(relatedContacts.map(c => c.phoneNumber).filter((p): p is string => !!p))
    );
    const secondaryIds = relatedContacts
      .filter(c => c.linkPrecedence === 'secondary')
      .map(c => c.id);

    res.status(200).json({
      contact: {
        primaryContactId: primaryContact.id,
        emails: uniqueEmails,
        phoneNumbers: uniquePhones,
        secondaryContactIds: secondaryIds,
      },
    });
  } catch (error) {
    console.error('Error in /identify:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Server running at: \x1b[36m${url}\x1b[0m`);
});
