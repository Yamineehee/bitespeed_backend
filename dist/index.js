"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
app.use(express_1.default.json());
const PORT = process.env.PORT || 4000;
// Add GET / route to prevent "Cannot GET /"
app.get('/', (req, res) => {
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
app.post('/identify', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, phoneNumber } = req.body;
        if (!email && !phoneNumber) {
            return res.status(400).json({ error: 'Email or phoneNumber is required' });
        }
        // Step 1: Find all existing matching contacts
        const existingContacts = yield prisma.contact.findMany({
            where: {
                OR: [
                    email ? { email } : undefined,
                    phoneNumber ? { phoneNumber } : undefined,
                ].filter(Boolean),
            },
            orderBy: { createdAt: 'asc' },
        });
        // Step 2: Determine primary contact
        let primaryContact = existingContacts.find(c => c.linkPrecedence === 'primary') || existingContacts[0];
        if (!primaryContact && (email || phoneNumber)) {
            // If no contact exists, create a new primary contact
            primaryContact = yield prisma.contact.create({
                data: {
                    email,
                    phoneNumber,
                    linkPrecedence: 'primary',
                },
            });
        }
        else if (primaryContact) {
            // Merge multiple primary contacts if found
            const primaryContacts = existingContacts.filter(c => c.linkPrecedence === 'primary');
            for (const contact of primaryContacts) {
                if (contact.id !== primaryContact.id) {
                    yield prisma.contact.update({
                        where: { id: contact.id },
                        data: {
                            linkPrecedence: 'secondary',
                            linkedId: primaryContact.id,
                        },
                    });
                }
            }
            // Check for duplicate entry
            const isExactDuplicate = existingContacts.some(c => c.email === email && c.phoneNumber === phoneNumber);
            if (!isExactDuplicate && (email || phoneNumber)) {
                const existsWithEmail = existingContacts.some(c => c.email === email);
                const existsWithPhone = existingContacts.some(c => c.phoneNumber === phoneNumber);
                // Only insert a new contact if this combo is unique
                if (!existsWithEmail || !existsWithPhone) {
                    yield prisma.contact.create({
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
        const relatedContacts = yield prisma.contact.findMany({
            where: {
                OR: [
                    { id: primaryContact.id },
                    { linkedId: primaryContact.id },
                ],
            },
            orderBy: { createdAt: 'asc' },
        });
        const uniqueEmails = Array.from(new Set(relatedContacts.map(c => c.email).filter((e) => !!e)));
        const uniquePhones = Array.from(new Set(relatedContacts.map(c => c.phoneNumber).filter((p) => !!p)));
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
    }
    catch (error) {
        console.error('Error in /identify:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}));
app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Server running at: \x1b[36m${url}\x1b[0m`);
});
