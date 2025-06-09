import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
app.use(express.json());

// 
type Contact = NonNullable<Awaited<ReturnType<typeof prisma.contact.findFirst>>>;

const PORT = process.env.PORT || 4000;

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
    const { email, phoneNumber }: { email?: string; phoneNumber?: string } = req.body;

    if (!email && !phoneNumber) {
      return res.status(400).json({ error: 'Email or phoneNumber is required' });
    }

    // Step 1: Find all existing matching contacts
    const existingContacts: Contact[] = await prisma.contact.findMany({
      where: {
        OR: [
          email ? { email } : undefined,
          phoneNumber ? { phoneNumber } : undefined,
        ].filter(Boolean) as any,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Step 2: Determine primary contact
    let primaryContact: Contact | undefined =
      existingContacts.find((c: Contact) => c.linkPrecedence === 'primary') || existingContacts[0];

    if (!primaryContact && (email || phoneNumber)) {
      // No contact exists, create a new primary
      primaryContact = await prisma.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: 'primary',
        },
      });
    } else if (primaryContact) {
      // Merge primary contacts
      const primaryContacts = existingContacts.filter(
        (c: Contact) => c.linkPrecedence === 'primary'
      );
      for (const c of primaryContacts) {
        if (c.id !== primaryContact.id) {
          await prisma.contact.update({
            where: { id: c.id },
            data: {
              linkPrecedence: 'secondary',
              linkedId: primaryContact.id,
            },
          });
        }
      }

      // Prevent duplicate
      const isExactDuplicate = existingContacts.some(
        (c: Contact) => c.email === email && c.phoneNumber === phoneNumber
      );

      if (!isExactDuplicate && (email || phoneNumber)) {
        const existsWithEmail = existingContacts.some((c: Contact) => c.email === email);
        const existsWithPhone = existingContacts.some((c: Contact) => c.phoneNumber === phoneNumber);

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

    // Step 3: Refetch all related contacts
    const relatedContacts: Contact[] = await prisma.contact.findMany({
      where: {
        OR: [
          { id: primaryContact.id },
          { linkedId: primaryContact.id },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    const uniqueEmails = Array.from(
      new Set(relatedContacts.map((c: Contact) => c.email).filter((e): e is string => !!e))
    );
    const uniquePhones = Array.from(
      new Set(relatedContacts.map((c: Contact) => c.phoneNumber).filter((p): p is string => !!p))
    );
    const secondaryIds = relatedContacts
      .filter((c: Contact) => c.linkPrecedence === 'secondary')
      .map((c: Contact) => c.id);

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
  console.log(`Server running at: \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
});
