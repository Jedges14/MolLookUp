import './Landing.css';
import getrandomFact from './landingAPI';
import {useEffect, useState} from 'react';
import molecules from './molecules';
import PubChem from './submitAPI';


const LandingPage = () => {
    // load random molecule
    const [mol, setmol] = useState('molecule loading..');  
    const timer = 3 * 60 * 1000;
    useEffect(() => {
        const molupdate = () => {
            const now = Date.now();
            const past = parseInt(localStorage.getItem('molupdateTime'), 10);
            const savedMol = localStorage.getItem('mol');

                
            if (past && now - past <= timer && savedMol){
                setmol(JSON.parse(savedMol));
            }
            else{
                const newRandom = molecules[Math.floor(Math.random() * molecules.length)];
                setmol(newRandom);
                localStorage.setItem('mol', JSON.stringify(newRandom));
                localStorage.setItem('molupdateTime', now.toString());
            }
        };
        molupdate();
        // check every one minute when user is still on page
        const inter = setInterval(() => {
            molupdate();
        }, 60*1000);

        return () => clearInterval(inter);
    }, []);

    // effect for daily random fact
    const [fact, setFact] = useState('Loading Science Facts..');
    useEffect(() => {
        const today = new Date().toISOString().split('T')[0]; // e.g., "2025-06-23"
        const savedDate = localStorage.getItem('factDate');
        const savedFact = localStorage.getItem('fact');
        

        if (savedDate === today && savedFact) {
            setFact(savedFact);
        } else {
            getrandomFact().then(f => {
            setFact(f);
            localStorage.setItem('fact', f);
            localStorage.setItem('factDate', today);
            }).catch(() => {
            setFact('Sorry, no fact today.');
            });
        }
    }, []);


    // user input
    const [val, setVal] = useState('');
    const change = newInput => {
        setVal(newInput.target.value);
    }

    //text area
    const [molDes, setmolDes] = useState('');
    const [showDes, setshowDes] = useState(false);
    const click = async (event) =>{
        event.preventDefault();
        if (!val.trim()) return alert('Enter a molecule name.');

        try{
            const data = await PubChem(val);
            setmolDes(data.extract);
            setshowDes(true);
        }
        catch(e){
            setmolDes(e.message);
            setshowDes(true)
            
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
                <h3 style={{justifyContent:'center'}}>Daily Random Fact</h3>
                <p>{fact}</p>
            </div>
            <div className="Mol-History">
                <h3 >Molecule of the day!!</h3>
                <h4>{mol.name}</h4>
                <img className='molImg' src={`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${mol.cid}/PNG`} alt='Can not display molecule' />
            </div>
            <div className='Mol-des'> 
                <p><h3>LookUp of {mol.name}</h3></p>   
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
            <form >
                <label for ="input">
                    <p className="inputText" >
                        Find chemical compounds, see 3D models, and explore molecular data.
                    </p>
                </label>
                
                <input onChange={change} 
                    type="text" id="input" name="search" 
                    value={val} placeholder='Enter molecule name here'
                    required
                />
                <input type='submit' formTarget='description-field area' onClick={click} />
            
           </form>
        </div>

        {showDes && (<div className="description-field-area" >
            <p>{molDes}</p>
        </div>)}

        <div className="footer-Area">
            <footer>
                <h3>Instagram</h3>
                <h3>Email</h3>
                <h3>API links from API ninja and PUBCHEM</h3>
            </footer>
        </div>
    </div>

    )
}

export default LandingPage;