import './Landing.css';
import {useEffect, useState} from 'react';
import molecules from './molecules';
import { getDailyFact, searchCompounds, structureImageUrl } from './api';

// A new "molecule of the day" is picked at most every 3 minutes (kept in localStorage).
const MOL_TTL_MS = 3 * 60 * 1000;

function currentMolecule(now = Date.now()) {
    const past = parseInt(localStorage.getItem('molupdateTime'), 10);
    const savedMol = localStorage.getItem('mol');
    if (past && now - past <= MOL_TTL_MS && savedMol) {
        return JSON.parse(savedMol);
    }
    const newRandom = molecules[Math.floor(Math.random() * molecules.length)];
    localStorage.setItem('mol', JSON.stringify(newRandom));
    localStorage.setItem('molupdateTime', now.toString());
    return newRandom;
}

const today = () => new Date().toISOString().split('T')[0]; // e.g., "2025-06-23"

/** Today's fact if one was already fetched today, else null. */
function savedFactForToday() {
    return localStorage.getItem('factDate') === today() ? localStorage.getItem('fact') : null;
}

const LandingPage = () => {
    // load random molecule
    const [mol, setmol] = useState(() => currentMolecule());
    useEffect(() => {
        // check every one minute when user is still on page
        const inter = setInterval(() => setmol(currentMolecule()), 60 * 1000);
        return () => clearInterval(inter);
    }, []);

    // daily random fact: fetched at most once per day per browser
    const [fact, setFact] = useState(() => savedFactForToday() ?? 'Loading Science Facts..');
    useEffect(() => {
        if (savedFactForToday()) return;
        getDailyFact().then(f => {
            setFact(f);
            localStorage.setItem('fact', f);
            localStorage.setItem('factDate', today());
        }).catch(() => {
            setFact('Sorry, no fact today.');
        });
    }, []);


    // user input
    const [val, setVal] = useState('');
    const change = newInput => {
        setVal(newInput.target.value);
    }

    // search results: status is 'idle' | 'loading' | 'done' | 'error'
    const [search, setSearch] = useState({ status: 'idle', query: '', results: [], error: '' });
    const submit = async (event) => {
        event.preventDefault();
        const query = val.trim();
        if (!query) return;

        setSearch({ status: 'loading', query, results: [], error: '' });
        try {
            const data = await searchCompounds(query);
            setSearch({ status: 'done', query, results: data.results, error: '' });
        } catch (e) {
            setSearch({ status: 'error', query, results: [], error: e.message });
        }
    };


    return (
        <div className='Main'>
        <div className ="Title_Box">
            {/* three bar logo for menu lives here */}
            <div className="nav-bar">
                <nav>
                    <ul>
                        <li>Home</li>
                        <li>Back</li>
                        <li>Contact</li>
                    </ul>
                </nav>
            </div>

            <div className="wesbiteName">
                <h2>MolLookUp</h2>
            </div>

            {/* user icon lives here */}
            <div className="UserLogin">
                <h3>UserLogin</h3>
            </div>
        </div>

        <div className="fact-Container">
            <div className="Random-Mol-fact">
                <h3>Daily Random Fact</h3>
                <p>{fact}</p>
            </div>
            <div className="Mol-History">
                <h3 >Molecule of the day!!</h3>
                <h4>{mol.name}</h4>
                {mol.cid && (
                    <img className='molImg' src={structureImageUrl(mol.cid)} alt={`2D structure of ${mol.name}`} />
                )}
            </div>
            <div className='Mol-des'>
                <h3>LookUp of {mol.name}</h3>
                <ul>
                    <li>chemical Formula: {mol.formula}</li>
                    <li>mol Weight: {mol.weight}</li>
                </ul>
                <p>{mol.summary}</p>
                <p>FunFact: {mol.funFact}</p>    
            </div>
            
        </div>

        {/* input the search */}
        <div className="Search-Container">
            <form onSubmit={submit} role="search">
                <label htmlFor="input" className="inputText">
                    Find chemical compounds and explore their structures and molecular data.
                </label>

                <input onChange={change}
                    type="text" id="input" name="search"
                    value={val} placeholder='Enter molecule name or PubChem CID'
                    maxLength={200}
                    required
                />
                <button type='submit' disabled={search.status === 'loading'}>Search</button>

           </form>
        </div>

        {search.status !== 'idle' && (
            <div className="description-field-area" aria-live="polite">
                {search.status === 'loading' && <p>Searching for “{search.query}”…</p>}
                {search.status === 'error' && <p role="alert">{search.error}</p>}
                {search.status === 'done' && search.results.length === 0 && (
                    <p>No compounds found for “{search.query}”. Check the spelling and try again.</p>
                )}
                {search.status === 'done' && search.results.length > 0 && (
                    <ul className="results">
                        {search.results.map((c) => (
                            <li key={c.cid} className="result">
                                <img src={structureImageUrl(c.cid)} alt={`2D structure of ${c.name}`} loading="lazy" />
                                <div>
                                    <h4>{c.name}</h4>
                                    <p>Formula: {c.formula ?? 'n/a'}</p>
                                    <p>Molecular weight: {c.mw != null ? `${c.mw} g/mol` : 'n/a'}</p>
                                    <p>PubChem CID: {c.cid}</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        )}

        <div className="footer-Area">
            <footer>
                <h3>Instagram</h3>
                <h3>Email</h3>
                <h3>Data from PubChem; facts from API Ninjas</h3>
            </footer>
        </div>
    </div>

    )
}

export default LandingPage;